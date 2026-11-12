'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {normalizeCoordinator,makeJob,executionSpec,CoordinatorRunner}=require('../coordinator.cjs');
const project=fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-coord-'));
const params={title:'City Route - QA zdjęć',goal:'Sprawdź dodawanie zdjęć i zaproponuj testy regresji',projectRoot:project};
const next=()=>new Promise(r=>setTimeout(r,15));
test('opt-in; concrete project folder and user goal are mandatory',()=>{
  assert.deepEqual(normalizeCoordinator({}).jobs,[]);
  assert.equal(normalizeCoordinator({}).enabled,false);
  assert.throws(()=>makeJob({...params,projectRoot:'./foo'}),/pełną lokalną/);
  assert.throws(()=>makeJob({...params,projectRoot:path.join(project,'missing')}),/Nie znaleziono/);
  assert.throws(()=>makeJob({...params,goal:'test'}),/min/);
  const a=makeJob(params);
  assert.equal(a.status,'queued');
  assert.equal(a.stages.length,2);
  assert.equal(a.stages[1].provider,'claude');
  assert.equal(makeJob({...params,reviewer:'codex'}).stages[1].provider,'codex');
});
test('restricted, bounded CLI arguments and no shell',()=>{
  const a=makeJob(params);
  const spec=executionSpec(a);
  assert.match(spec.command,/claude(\.exe)?$/i);
  // Only flags Claude Code has: "--restricted" / "--permission-prompts" stopped every stage.
  assert.ok(!spec.args.includes('--restricted')&&!spec.args.includes('--permission-prompts'));
  assert.deepEqual(spec.args.slice(spec.args.indexOf('--permission-mode'),spec.args.indexOf('--permission-mode')+2),['--permission-mode','dontAsk']);
  assert.deepEqual(spec.args.slice(spec.args.indexOf('--allowedTools')+1,spec.args.indexOf('--allowedTools')+2),['Read,Glob,Grep']);
  assert.ok(spec.args.includes('--no-session-persistence'));
  assert.ok(spec.args.includes('--max-budget-usd'));
  assert.deepEqual(spec.args.slice(spec.args.indexOf('--tools')+1,spec.args.indexOf('--tools')+2),['Read,Glob,Grep']);
  assert.ok(!spec.args.includes('--dangerously-skip-permissions'));
  const b=makeJob({...params,reviewer:'codex'});
  b.stepIndex=1;
  const c=executionSpec(b);
  assert.equal(c.command,'codex');
  assert.deepEqual(c.args.slice(0,6),['exec','--sandbox','read-only','--ask-for-approval','never','--skip-git-repo-check']);
});
test('automatic handoff passes first agent output into second run; only terminal alert reaches user',async()=>{
  const c=normalizeCoordinator({enabled:true,jobs:[]});
  const j=makeJob({...params,reviewer:'codex'});c.jobs.push(j);
  const calls=[],notifications=[];
  function spawnAgent(command,args,options){
    calls.push({command,args,options});
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    queueMicrotask(()=>{
      child.stdout.emit('data',calls.length===1?'Wynik analizy: uwaga na import zdjęć':'Recenzja: weryfikować źródła');
      child.emit('close',0,null);
    });
    return child;
  }
  const runner=new CoordinatorRunner({getState:()=>c,persist:()=>{},notify:(text,level)=>notifications.push({text,level}),spawnAgent});
  runner.tick();
  await next();
  assert.equal(calls.length,2,'second agent should launch without human copy/paste');
  assert.match(calls[0].command,/claude(\.exe)?$/i);
  assert.equal(calls[1].command,'codex');
  assert.match(calls[1].args.at(-1),/uwaga na import zdjęć/);
  assert.equal(calls[0].options.shell,false);
  assert.equal(calls[1].options.shell,false);
  assert.equal(j.status,'done');
  assert.equal(j.stepIndex,2);
  assert.equal(notifications.filter(x=>x.level==='reminder').length,1);
  assert.match(notifications.find(x=>x.level==='reminder').text,/oba etapy/);
});
test('two jobs may start concurrently, but never more than two workers',()=>{
  const c=normalizeCoordinator({enabled:true,jobs:[]});
  for(let n=0;n<3;n++)c.jobs.push(makeJob({...params,title:params.title+' '+n}));
  let count=0;
  function spawnAgent(){
    count++;
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    child.kill=()=>{};return child;
  }
  const runner=new CoordinatorRunner({getState:()=>c,persist:()=>{},notify:()=>{},spawnAgent});
  runner.tick();runner.tick();
  assert.equal(count,2);
  assert.equal(c.jobs.filter(j=>j.status==='running').length,2);
  assert.equal(c.jobs.filter(j=>j.status==='queued').length,1);
  runner.stop();
});
test('missing CLI fails once, alerts user and never enters an unbounded retry loop',async()=>{
  const c=normalizeCoordinator({enabled:true,jobs:[]}),job=makeJob(params);c.jobs.push(job);
  let launches=0;const notifications=[];
  const runner=new CoordinatorRunner({
    getState:()=>c,persist:()=>{},notify:(...x)=>notifications.push(x),
    spawnAgent:()=>{launches++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();queueMicrotask(()=>child.emit('error',new Error('ENOENT')));return child;}
  });
  runner.tick();await next();runner.tick();runner.tick();
  assert.equal(job.status,'attention');
  assert.equal(launches,1);
  assert.equal(notifications.filter(x=>x[1]==='reminder').length,1);
});
test('manual retry flag survives persisted normalization',()=>{
  const j=makeJob(params);j.status='attention';j.stages[0].status='attention';j.stages[0].retryUsed=true;
  const rebuilt=normalizeCoordinator({enabled:false,jobs:[j]});
  assert.equal(rebuilt.jobs[0].stages[0].retryUsed,true);
});
test('duplicate Quit command is removed from Settings but stays in three-dot menu',()=>{
  const panel=fs.readFileSync(path.join(__dirname,'..','ui','panel.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','ui','panel.html'),'utf8');
  assert.doesNotMatch(panel,/settings-exit/);
  assert.match(html,/data-action="quit"/);
  assert.match(html,/data-action="show-settings"/);
});
test.after(()=>fs.rmSync(project,{recursive:true,force:true}));

test('Windows: Claude is found as a real .exe, never a bare name the no-shell start cannot run',()=>{
  const {claudeCommand}=require('../coordinator.cjs');
  const W=path.win32,appdata=W.join('C:','Users','me','AppData','Roaming');
  const npmExe=W.join(appdata,'npm','node_modules','@anthropic-ai','claude-code','bin','claude.exe');
  const env={APPDATA:appdata,USERPROFILE:W.join('C:','Users','me'),PATH:W.join('C:','Windows')};
  assert.equal(claudeCommand({env,platform:'win32',exists:f=>f===npmExe}),npmExe);
  const own=W.join('D:','claude.exe');
  assert.equal(claudeCommand({env:{...env,RATCHET_CLAUDE_PATH:own},platform:'win32',exists:f=>f===own}),own);
  assert.equal(claudeCommand({env,platform:'linux',exists:()=>false}),'claude');
});

test('"Sprawdź pracę": the folder changes Rachet saw go into the agent prompt',()=>{
  const {promptFor}=require('../coordinator.cjs');
  const job=makeJob({...params,context:'Gałąź:\nclaude/x\n\nNiezapisane zmiany (git status):\n M app.js'});
  assert.match(promptFor(job),/What Rachet saw in this folder \(git\):\nGałąź:\nclaude\/x/);
  assert.equal(normalizeCoordinator({jobs:[job]}).jobs[0].context,job.context,'kept across restarts');
  const src=fs.readFileSync(path.join(__dirname,'..','server.cjs'),'utf8');
  assert.match(src,/key==='coordinator:check'/);
  assert.match(src,/execFileSync\('git',args,\{cwd:dir/);
});
