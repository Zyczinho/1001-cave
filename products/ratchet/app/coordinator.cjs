'use strict';
// Ratchet Coordinator v1: opt-in, bounded, READ-ONLY Claude CLI handoffs.
// This module does not send messages to ChatGPT/Claude web chats or edit/merge/deploy code.
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const ROLES=['analysis','review'];
const MAX_JOBS=30;
const MAX_GOAL=3000;
const MAX_OUTPUT=6000;
const MAX_ACTIVE=2;
const MAX_RUNTIME_MS=6*60*1000;
const MAX_BUDGET_USD='0.35'; // per stage, estimated by Claude; can be exceeded
const trim=(v,n)=>String(v??'').trim().slice(0,n);
const iso=()=>new Date().toISOString();
const safeStatus=new Set(['queued','running','attention','done','cancelled']);
function normalizeCoordinator(raw){
  const r=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const jobs=Array.isArray(r.jobs)?r.jobs.slice(-MAX_JOBS).map(j=>{
    const stages=Array.isArray(j.stages)?j.stages.slice(0,2).map((s,i)=>({
      role:ROLES[i],provider:'claude',status:safeStatus.has(s?.status)?s.status:'queued',
      startedAt:trim(s?.startedAt,60),finishedAt:trim(s?.finishedAt,60),
      summary:trim(s?.summary,MAX_OUTPUT),error:trim(s?.error,400),retryUsed:s?.retryUsed===true
    })):[];
    return {id:trim(j.id,80),title:trim(j.title,120),goal:trim(j.goal,MAX_GOAL),
      projectRoot:trim(j.projectRoot,1000),createdAt:trim(j.createdAt,60),
      updatedAt:trim(j.updatedAt,60),status:safeStatus.has(j.status)?j.status:'queued',
      stepIndex:Math.max(0,Math.min(2,Math.floor(Number(j.stepIndex)||0))),
      alerted:j.alerted===true,stages:stages.length===2?stages:[
        {role:'analysis',provider:'claude',status:'queued',startedAt:'',finishedAt:'',summary:'',error:'',retryUsed:false},
        {role:'review',provider:'claude',status:'queued',startedAt:'',finishedAt:'',summary:'',error:'',retryUsed:false}
      ]};
  }).filter(j=>j.id&&j.title&&j.goal&&j.projectRoot):[];
  return {enabled:r.enabled===true,jobs};
}
function makeJob(data){
  const title=trim(data?.title,120),goal=trim(data?.goal,MAX_GOAL);
  const projectRoot=trim(data?.projectRoot,1000);
  if(title.length<3||goal.length<15)throw Error('Podaj tytuł i cel zadania (min. 15 znaków).');
  if(!path.isAbsolute(projectRoot))throw Error('Wskaż pełną lokalną ścieżkę folderu projektu.');
  let location;
  try {location=fs.realpathSync(projectRoot);if(!fs.statSync(location).isDirectory())throw Error('not directory');}
  catch {throw Error('Nie znaleziono lokalnego folderu projektu.');}
  if(/^\\\\/.test(location))throw Error('Ścieżki sieciowe nie są obsługiwane.');
  const at=iso();
  return {id:randomUUID(),title,goal,projectRoot:location,createdAt:at,updatedAt:at,
    status:'queued',stepIndex:0,alerted:false,stages:ROLES.map(role=>({
      role,provider:'claude',status:'queued',startedAt:'',finishedAt:'',summary:'',error:'',retryUsed:false
    }))};
}
function promptFor(job){
  const stage=job.stages[job.stepIndex];
  const previous=job.stepIndex?job.stages[job.stepIndex-1].summary:'';
  return [
    'RATCHET COORDINATOR — BOUNDED READ-ONLY STAGE.',
    'Role: '+(stage.role==='analysis'?'Analyst: investigate and propose concrete steps.':'Independent reviewer: inspect the previous result, challenge findings and propose acceptance tests.'),
    'Project: '+job.title,'Task: '+job.goal,
    'Working directory: '+job.projectRoot,
    previous?'Previous agent handoff:\n'+previous:'',
    'Do not edit files, commit, push, create PRs, install packages, or run commands.',
    'Use read-only built-in tools when necessary. Do not invoke network tools or connected apps.',
    'Conclude with: findings, evidence (paths), risks, next action. No claims of deployment.',
    'Return your concise report in Polish, max 3000 characters.'
  ].filter(Boolean).join('\n\n').slice(0,11000);
}
function claudeArgs(job){
  return ['-p','--restricted','--permission-mode','plan','--permission-prompts','none',
    '--tools','Read,Glob,Grep','--disallowedTools','mcp__*','--disable-slash-commands',
    '--no-session-persistence','--max-budget-usd',MAX_BUDGET_USD,'--max-turns','6',
    '--output-format','text',promptFor(job)];
}
class CoordinatorRunner {
  constructor({getState,persist,notify,spawnAgent=spawn,now=Date.now}){
    this.getState=getState;this.persist=persist;this.notify=notify;
    this.spawnAgent=spawnAgent;this.now=now;this.active=new Map();this.stopped=false;
  }
  current(){return this.getState();}
  tick(){
    if(this.stopped||!this.current().enabled)return;
    const available=MAX_ACTIVE-this.active.size;
    if(available<=0)return;
    const queued=this.current().jobs.filter(j=>j.status==='queued');
    for(const job of queued.slice(0,available))this.launch(job);
  }
  launch(job){
    if(this.active.has(job.id)||job.status!=='queued')return;
    const stage=job.stages[job.stepIndex];
    if(!stage){this.fail(job,'Brak następnego etapu.');return;}
    // No shell and NO user-controlled executable/flags. Fail closed if native CLI unavailable.
    const args=claudeArgs(job);
    let child;
    try{
      child=this.spawnAgent('claude',args,{
        cwd:job.projectRoot,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],
        env:{...process.env,RATCHET_COORDINATOR_JOB:job.id,RATCHET_DISABLE_HOOKS:'1'}
      });
    }catch(e){this.fail(job,'Nie uruchomiono Claude CLI: '+e.message);return;}
    job.status='running';job.updatedAt=iso();stage.status='running';stage.startedAt=iso();
    let stdout='',stderr='',finished=false;
    const timer=setTimeout(()=>{
      if(!finished){try{child.kill();}catch{};complete('Przekroczono limit 6 minut.');}
    },MAX_RUNTIME_MS);
    const complete=error=>{
      if(finished)return;
      finished=true;clearTimeout(timer);this.active.delete(job.id);
      if(this.stopped)return;
      if(error){this.fail(job,error);this.tick();return;}
      const result=trim(stdout,MAX_OUTPUT);
      if(!result){this.fail(job,'Agent zakończył proces bez odpowiedzi. '+trim(stderr,140));this.tick();return;}
      stage.status='done';stage.summary=result;stage.finishedAt=iso();job.updatedAt=iso();
      job.stepIndex++;
      if(job.stepIndex>=job.stages.length){
        job.status='done';this.persist();
        this.notify('Koordynator: '+job.title+' — oba etapy analizy zakończone. Sprawdź raport.','reminder','','coordinator');
      }else{
        job.status='queued';this.persist();
        // Transfer is automatic: next run receives the previous agent's actual output.
        this.notify('Koordynator: '+job.title+' — przekazano wynik analizy drugiemu agentowi.','info','','handoff');
      }
      this.tick();
    };
    this.active.set(job.id,{child,complete});
    this.persist();
    child.stdout?.on('data',buf=>{stdout=(stdout+String(buf)).slice(-MAX_OUTPUT);});
    child.stderr?.on('data',buf=>{stderr=(stderr+String(buf)).slice(-1800);});
    child.on('error',e=>complete('Błąd uruchomienia Claude CLI: '+e.message));
    child.on('close',(code,signal)=>complete(code===0?null:'Claude CLI exit '+code+(signal?' / '+signal:'')+'. '+trim(stderr,250)));
  }
  fail(job,reason){
    job.status='attention';job.updatedAt=iso();job.alerted=true;
    const stage=job.stages[job.stepIndex];
    if(stage){stage.status='attention';stage.error=trim(reason,400);stage.finishedAt=iso();}
    this.persist();
    this.notify('Koordynator: '+job.title+' — przerwano przekazanie. '+trim(reason,140),'reminder','','coordinator');
  }
  reconcile(){
    // A process from a previous Ratchet backend is not proof of an active agent.
    for(const job of this.current().jobs.filter(j=>j.status==='running')){
      this.fail(job,'Ratchet uruchomił się ponownie. Nie można potwierdzić, czy agent kontynuuje pracę.');
    }
  }
  stop(){
    this.stopped=true;
    for(const [id,{child}] of this.active){
      const job=this.current().jobs.find(j=>j.id===id);
      if(job){job.status='attention';job.updatedAt=iso();const stage=job.stages[job.stepIndex];if(stage){stage.status='attention';stage.error='Przerwano przez zamknięcie Ratcheta.';}}
      try{child.kill();}catch{}
    }
    this.active.clear();this.persist();
  }
}
module.exports={normalizeCoordinator,makeJob,promptFor,claudeArgs,CoordinatorRunner,MAX_ACTIVE,MAX_RUNTIME_MS};
