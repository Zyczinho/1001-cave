'use strict';
// ChatGPT Workspace Agents API watcher. Genuine server-side run statuses, never DOM guessing.
// Does NOT observe arbitrary conversations at chatgpt.com or use ChatGPT browser cookies.
const {randomUUID}=require('node:crypto');
const API='https://api.chatgpt.com/v1/workspace_agents/';
const ACTIVE=new Set(['queued','in_progress','suspended']);
const TERMINAL=new Set(['completed','failed']);
const MAX_JOBS=40;
const safe=v=>String(v??'').trim();
const clip=(v,n)=>safe(v).slice(0,n);
const nowISO=()=>new Date().toISOString();
const validTrigger=id=>/^agtch_[A-Za-z0-9_-]{3,160}$/.test(id);
const validRun=id=>/^apirun_[A-Za-z0-9_-]{3,160}$/.test(id);
function chatUrl(value){
  try{
    const url=new URL(String(value||''));
    return url.protocol==='https:' && url.hostname==='chatgpt.com' &&
      /^\/c\/[A-Za-z0-9_-]{3,160}\/?$/.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash ? url.href : '';
  }catch{return '';}
}
function normalizeChatGPTRuns(raw){
  if(!Array.isArray(raw))return [];
  return raw.slice(0,MAX_JOBS).filter(x=>x&&typeof x==='object'&&
    validTrigger(safe(x.triggerId))&&safe(x.id)).map(x=>({
    id:clip(x.id,80),title:clip(x.title,160),triggerId:clip(x.triggerId,170),
    runId:validRun(safe(x.runId))?safe(x.runId):'',
    conversationUrl:chatUrl(x.conversationUrl),
    status:[...ACTIVE,...TERMINAL,'attention','submitting'].includes(x.status)?x.status:'attention',
    reason:clip(x.reason,300),createdAt:clip(x.createdAt,60),
    updatedAt:clip(x.updatedAt,60),alerted:x.alerted===true,
    pollFailures:Math.max(0,Math.min(3,Number(x.pollFailures)||0)),
    idempotencyKey:clip(x.idempotencyKey,80)
  }));
}
function newTask(data){
  const title=clip(data?.title,160),input=clip(data?.input,5000),
    triggerId=safe(data?.triggerId),conversationKey=clip(data?.conversationKey,160);
  if(title.length<3||input.length<12)throw Error('Podaj nazwę i treść zadania (min. 12 znaków).');
  if(!validTrigger(triggerId))throw Error('Wpisz poprawny identyfikator API kanału agenta ChatGPT: agtch_...');
  if(data?.conversationKey && conversationKey.length!==safe(data.conversationKey).length)
    throw Error('Klucz rozmowy jest za długi.');
  const at=nowISO();
  return {job:{
    id:randomUUID(),title,triggerId,runId:'',conversationUrl:'',status:'submitting',
    reason:'',createdAt:at,updatedAt:at,alerted:false,pollFailures:0,idempotencyKey:randomUUID()
  },input,conversationKey};
}
class ChatGPTWorkspaceWatcher{
  constructor({getJobs,persist,notify,token,fetchImpl=fetch}){
    this.getJobs=getJobs;this.persist=persist;this.notify=notify;
    this.token=safe(token);this.fetchImpl=fetchImpl;this.inFlight=new Set();
  }
  isConfigured(){return this.token.length>0;}
  headers(json=false){
    // Never persist or return the credential. It exists only in the backend environment.
    return {'Authorization':'Bearer '+this.token,...(json?{'Content-Type':'application/json'}:{})};
  }
  emit(job,message,phase){
    if(job.alerted)return;
    job.alerted=true;this.persist();
    this.notify(message,'reminder','',phase,job.conversationUrl);
  }
  setAttention(job,reason){
    job.status='attention';job.reason=clip(reason,300);job.updatedAt=nowISO();
    this.persist();
    this.emit(job,'ChatGPT wymaga uwagi: '+job.title+'. '+job.reason,'chatgpt-failure');
  }
  async create(data){
    if(!this.isConfigured())throw Error('Brak tokenu Workspace Agents. Integracja jest wyłączona.');
    const jobs=this.getJobs();
    if(jobs.length>=MAX_JOBS)throw Error('Limit 40 uruchomień. Usuń stare wpisy.');
    if(jobs.filter(x=>x.status==='submitting'||ACTIVE.has(x.status)).length>=4)
      throw Error('Limit czterech aktywnych uruchomień ChatGPT.');
    const {job,input,conversationKey}=newTask(data);
    jobs.unshift(job);this.persist(); // Preserve ambiguous submission; never silently retry POST.
    let response;
    try{
      response=await this.fetchImpl(API+encodeURIComponent(job.triggerId)+'/trigger',{
        method:'POST',headers:{...this.headers(true),'OpenAI-Beta':'workspace_agent_runs=v1',
          'Idempotency-Key':job.idempotencyKey},
        body:JSON.stringify({input,...(conversationKey?{conversation_key:conversationKey}:{})}),
        signal:AbortSignal.timeout(18000)
      });
    }catch{
      this.setAttention(job,'Nie udało się potwierdzić przyjęcia zadania przez API. Nie wysyłaj ponownie bez sprawdzenia.');
      return job;
    }
    if(response.status!==202){
      this.setAttention(job,'API ChatGPT odrzuciło uruchomienie (HTTP '+Number(response.status)+').');
      return job;
    }
    let payload;
    try{payload=await response.json();}catch{payload={};}
    job.conversationUrl=chatUrl(payload.conversation_url);
    if(!validRun(safe(payload.agent_trigger_run_id))){
      this.setAttention(job,'API przyjęło zlecenie, ale nie zwróciło ID uruchomienia beta. Nie można śledzić zakończenia.');
      return job;
    }
    job.runId=safe(payload.agent_trigger_run_id);job.status='queued';job.updatedAt=nowISO();
    this.persist();return job;
  }
  async pollOne(job){
    if(!this.isConfigured()||!validRun(job.runId)||!ACTIVE.has(job.status)||this.inFlight.has(job.id))return;
    this.inFlight.add(job.id);
    try{
      const response=await this.fetchImpl(API+encodeURIComponent(job.triggerId)+'/runs/'+encodeURIComponent(job.runId),{
        method:'GET',headers:this.headers(),signal:AbortSignal.timeout(12000)
      });
      if(!response.ok)throw Error('poll HTTP '+Number(response.status));
      const payload=await response.json();
      if(payload.id!==job.runId||payload.api_trigger_id!==job.triggerId)
        throw Error('different run');
      if(!ACTIVE.has(payload.status)&&!TERMINAL.has(payload.status))
        throw Error('unknown status');
      job.pollFailures=0;job.updatedAt=nowISO();
      job.conversationUrl=chatUrl(payload.conversation_url)||job.conversationUrl;
      job.status=payload.status;
      job.reason=payload.status==='failed'?clip(payload.error?.code||'Agent zwrócił błąd.',100):'';
      this.persist();
      if(payload.status==='completed')
        this.emit(job,'ChatGPT zakończył zadanie: '+job.title+'. Otwórz rozmowę i sprawdź rezultat.','chatgpt');
      if(payload.status==='failed')
        this.emit(job,'ChatGPT nie ukończył zadania: '+job.title+'. Sprawdź przyczynę.','chatgpt-failure');
    }catch{
      job.pollFailures=Math.min(3,(job.pollFailures||0)+1);
      if(job.pollFailures>=3)this.setAttention(job,'Utracono potwierdzenie statusu API. Nie oznacza to, że agent zakończył pracę.');
      else this.persist();
    }finally{this.inFlight.delete(job.id);}
  }
  async poll(){
    if(!this.isConfigured())return;
    const candidates=this.getJobs().filter(x=>ACTIVE.has(x.status)).slice(0,6);
    await Promise.all(candidates.map(x=>this.pollOne(x)));
  }
  async resumeMonitoring(id){
    const job=this.getJobs().find(x=>x.id===id);
    if(!job||job.status!=='attention'||!validRun(job.runId))
      throw Error('Nie można wznowić monitorowania bez ID uruchomienia.');
    if(!this.isConfigured())throw Error('Brak tokenu Workspace Agents.');
    job.status='in_progress';job.reason='';job.pollFailures=0;job.alerted=false;
    this.persist();await this.pollOne(job);return job;
  }
  remove(id){
    const jobs=this.getJobs();
    const ix=jobs.findIndex(x=>x.id===id);
    if(ix<0)throw Error('Nie znaleziono zlecenia.');
    if(ACTIVE.has(jobs[ix].status)||jobs[ix].status==='submitting')
      throw Error('Zadanie nadal działa. Usunięcie z monitora nie zatrzymuje agenta ChatGPT.');
    jobs.splice(ix,1);this.persist();return true;
  }
}
module.exports={ChatGPTWorkspaceWatcher,normalizeChatGPTRuns,chatUrl,newTask,validTrigger,validRun};
