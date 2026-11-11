'use strict';
// Ratchet 0.2: localhost-only companion for Windows, no Electron, no npm install.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {makeJob,CoordinatorRunner}=require('./coordinator.cjs');
const {CURRENT_VERSION,checkUpdate,stageUpdate} = require('./updater.cjs');
const {defaults, normalizeStore, normalizePanelSize, normalizeItem, dueTasks, dueEndTasks, dayKey, validateTarget, mergeRepoData, handoffText} = require('./core.cjs');

const PORT = Number(process.env.RATCHET_PORT || 47823);
const CLAUDE_PORT = Number(process.env.RATCHET_HOOK_PORT || 47822);
const DATA = path.join(process.env.APPDATA || path.join(os.homedir(), '.ratchet'), 'Ratchet', 'ratchet.json');
const UI_ROOT = path.resolve(__dirname, 'ui');
const JSON_LIMIT = 64 * 1024;
let state = defaults(), github = null, githubError = null, lastFetch = 0;
let appServer, hookServer, shuttingDown = false, quitRequested = false;
let panelRequests = 0, panelHideRequests = 0, orbResetRequests = 0, installingUpdate = false, updateAvailable = null;
const coordinatorRunner=new CoordinatorRunner({
  getState:()=>state.coordinator,persist:()=>save(),
  notify:(message,level,taskId,phase)=>activity(message,level,taskId,phase)
});
// Identity of the files actually running: answers "which copy and which build?" (RAT-001).
function buildInfo() {
  try {
    const ledger=readJson(path.join(__dirname,'ratchet-release-manifest.json'));
    return {commit:/^[0-9a-f]{7,40}$/.test(ledger.commit||'')?ledger.commit:null,manifestVersion:String(ledger.version||'')};
  } catch {return {commit:null,manifestVersion:null};}
}
const BUILD=buildInfo();
// Windows tools (Notepad, PowerShell Set-Content -Encoding UTF8) may add a UTF-8 BOM;
// it must never make an otherwise valid profile unreadable.
function readJson(file) {
  let text=fs.readFileSync(file,'utf8');
  if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
  return JSON.parse(text);
}

function read() {
  if (!fs.existsSync(DATA)) { state=defaults(); return; }
  try {state=normalizeStore(readJson(DATA));}
  catch(e) {
    console.error('[ratchet] Uszkodzony profil:',e.message);
    const previous=DATA+'.bak';
    try {
      state=normalizeStore(readJson(previous));
      // Preserve the corrupt original for diagnostics, then restore last-known-good
      // BEFORE future saves can accidentally overwrite the only valid backup.
      fs.copyFileSync(DATA,DATA+'.corrupt-'+Date.now());
      fs.copyFileSync(previous,DATA);
    } catch {throw Error('Nie można odczytać lub odtworzyć danych Ratcheta. Pliki nie zostały nadpisane: '+DATA);}
  }
}
function save() {
  fs.mkdirSync(path.dirname(DATA),{recursive:true});
  const tmp=DATA+'.tmp',backup=DATA+'.bak';
  fs.writeFileSync(tmp,JSON.stringify(state,null,2),'utf8');
  // Last-known-good copy protects against interrupted writes and accidental edits.
  if(fs.existsSync(DATA)) {try {fs.copyFileSync(DATA,backup);}catch(e){console.warn('[ratchet] Backup:',e.message);} }
  fs.renameSync(tmp,DATA);
}
function activity(message, level='info', taskId='', phase='') {
  const entry={id: String(Date.now()) + Math.random(),text:message,level,taskId,phase,at:new Date().toISOString()};
  state.activity.unshift(entry);state.activity=state.activity.slice(0,80);save();
  return entry;
}
function notification(task,phase,at){
  const start=phase==='start';
  return {
    id:`${Date.now()}-${task.id}-${phase}-${Math.random()}`,
    text:start
      ? `Początek: ${task.title} (${task.time}).`
      : `Planowany koniec: ${task.title} (${task.endTime}). Zakończ zadanie, gdy będzie gotowe.`,
    at:at.toISOString(),level:'reminder',phase,taskId:task.id
  };
}
function checkSchedule(now = new Date()) {
  let updated=false;
  const today=dayKey(now);
  for(const task of dueTasks(state,now)){
    state.reminded[`${today}:${task.id}:${task.snoozeUntil||'base'}`]=true;
    state.activity.unshift(notification(task,'start',now));
    updated=true;
  }
  for(const task of dueEndTasks(state,now)){
    state.reminded[`${today}:${task.id}:end`]=true;
    state.activity.unshift(notification(task,'end',now));
    updated=true;
  }
  if(updated){state.activity=state.activity.slice(0,80);save();}
}
function health() {
  const a=state.agents;
  const coordinator=state.coordinator?.jobs||[];
  const runs=github?.runs||[];
  const failed=runs.some(x=>x.status==='completed'&&['failure','timed_out','action_required'].includes(x.conclusion));
  const blocked=a.some(x=>x.status==='blocked')||coordinator.some(x=>x.status==='attention');
  const attention=a.some(x=>x.status==='needs_attention')||(github?.overlapping||[]).length>0;
  const working=a.some(x=>x.status==='working')||coordinator.some(x=>x.status==='running')||runs.some(x=>x.status!=='completed');
  return failed||blocked?'blocked':attention?'needs_attention':working?'working':runs.some(x=>x.conclusion==='success')?'ready':'idle';
}
function snapshot() {return {state,github,githubError,platform:process.platform};}
async function refreshGithub(force=false) {
  if(!force && Date.now()-lastFetch<10*60_000) return {github,githubError};
  const repo=state.settings.repo||'';
  if(!/^[-\w.]+\/[-\w.]+$/.test(repo)) {githubError='Repo powinno mieć format właściciel/nazwa';return {github,githubError};}
  lastFetch=Date.now();
  try {
    const headers={'Accept':'application/vnd.github+json','User-Agent':'Ratchet/'+CURRENT_VERSION,'X-GitHub-Api-Version':'2022-11-28'};
    async function gh(endpoint) {
      const res=await fetch('https://api.github.com'+endpoint,{headers,signal:AbortSignal.timeout(12000)});
      if(!res.ok) throw Error('GitHub HTTP '+res.status);
      return res.json();
    }
    const [prs,runs]=await Promise.all([gh(`/repos/${repo}/pulls?state=open&per_page=20`),gh(`/repos/${repo}/actions/runs?per_page=15`)]);
    const inspected=prs.slice(0,4);
    const results=await Promise.allSettled(inspected.map(p=>gh(`/repos/${repo}/pulls/${p.number}/files?per_page=100`)));
    const files={};
    for(let i=0;i<results.length;i++) if(results[i].status==='fulfilled') files[inspected[i].number]=results[i].value.map(x=>x.filename);
    github=mergeRepoData(prs,runs.workflow_runs,files);
    github.repo=repo;
    github.partialFiles=prs.length>4;
    githubError=null;
  } catch(e) {githubError=String(e.message||e);}
  return {github,githubError};
}
function json(res,data,status=200) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'http://127.0.0.1:'+PORT});
  res.end(JSON.stringify(data));
}
function fail(res,msg,status=400) {json(res,{error:String(msg)},status);}
function acceptPost(req) {
  const origin=req.headers.origin;
  // Same-origin requests from Ratchet UI or explicit local scripts without Origin only.
  return (!origin||origin===`http://127.0.0.1:${PORT}`) && req.headers['x-ratchet-local']==='1' && (req.headers['content-type']||'').startsWith('application/json');
}
function bodyOf(req) {
  return new Promise((resolve,reject)=>{
    let data='';
    req.on('data',chunk=>{ data+=chunk; if(data.length>JSON_LIMIT){reject(Error('Payload za duży'));req.destroy();}});
    req.on('end',()=>{try{resolve(JSON.parse(data||'{}'));}catch{reject(Error('Niepoprawny JSON'));}});
    req.on('error',reject);
  });
}
function openTarget(kind,target) {
  const t=validateTarget(kind,target);
  if(process.platform!=='win32') return Promise.resolve({wouldOpen:t});
  if(kind==='folder' && !fs.existsSync(t)) throw Error('Folder lub plik nie istnieje: '+t);
  // explorer.exe opens a validated http(s) URL in the default browser or a folder in
  // Explorer. No shell, no quoting, and no hidden encoded PowerShell command line,
  // which antivirus behaviour shields flag as malware.
  const explorer=path.join(process.env.SystemRoot||'C:\\Windows','explorer.exe');
  const proc=spawn(explorer,[t],{windowsHide:true,stdio:'ignore',detached:true});
  proc.on('error',e=>console.error('Launch:',e.message));proc.unref();
  return Promise.resolve({opened:true});
}
async function handleAction(key,data) {
  if(key==='coordinator:create'){
    if(state.coordinator.jobs.length>=30)throw Error('Limit 30 zadań — najpierw usuń stare.');
    const job=makeJob(data);
    state.coordinator.jobs.unshift(job);save();
    coordinatorRunner.tick();return job;
  }
  if(key==='coordinator:enable'){
    if(typeof data.enabled!=='boolean')throw Error('Podaj true/false.');
    state.coordinator.enabled=data.enabled;save();
    if(data.enabled)coordinatorRunner.tick();
    return {enabled:state.coordinator.enabled};
  }
  if(key==='coordinator:remove'){
    const job=state.coordinator.jobs.find(j=>j.id===String(data.id||''));
    if(!job)throw Error('Nie znaleziono zadania');
    if(job.status==='running')throw Error('Najpierw wyłącz wykonywanie i poczekaj na koniec bieżącego etapu.');
    state.coordinator.jobs=state.coordinator.jobs.filter(j=>j.id!==job.id);
    save();return {removed:true};
  }
  if(key==='coordinator:retry'){
    // No automatic retries. A user explicitly authorizes one single-stage retry.
    const job=state.coordinator.jobs.find(j=>j.id===String(data.id||''));
    if(!job||job.status!=='attention')throw Error('Ponowić można tylko zadanie wymagające uwagi');
    const stage=job.stages[job.stepIndex];
    if(!stage)throw Error('Brak etapu');
    if(stage.retryUsed)throw Error('Jedna próba ponowienia została już wykorzystana');
    stage.retryUsed=true;stage.status='queued';stage.error='';
    job.status='queued';job.alerted=false;job.updatedAt=new Date().toISOString();
    save();coordinatorRunner.tick();return {queued:true};
  }
  if(key==='item:save'){
    if(!['schedule','links','agents'].includes(data.collection)) throw Error('Nieznana kolekcja');
    const clean=normalizeItem(data.collection,data.item);
    const i=state[data.collection].findIndex(x=>x.id===clean.id);
    if(data.collection==='schedule'&&i>=0&&!Array.isArray(data.item?.completedDates)){
      // Form edits should not accidentally erase the persistent calendar history.
      clean.completedDates=state.schedule[i].completedDates||[];
    }
    if(i>=0)state[data.collection][i]=clean;else state[data.collection].push(clean);
    save();return clean;
  }
  if(key==='item:remove'){
    if(!['schedule','links','agents'].includes(data.collection)) throw Error('Nieznana kolekcja');
    state[data.collection]=state[data.collection].filter(x=>x.id!==data.id);save();return true;
  }
  if(key==='activity:clear'){
    const removed=state.activity.length;
    // Clearing a signal is NOT completing/deleting its task or resetting reminders.
    state.activity=[];save();return {removed};
  }
  if(key==='activity:remove'){
    const id=String(data.id||'');
    const previous=state.activity.length;
    state.activity=state.activity.filter(x=>x.id!==id);
    if(state.activity.length!==previous)save();
    return {removed:previous-state.activity.length};
  }
  if(key==='settings:save'){
    const s={...state.settings};
    if(typeof data.settings?.repo==='string'&&/^[-\w.]+\/[-\w.]+$/.test(data.settings.repo.trim())){s.repo=data.settings.repo.trim();lastFetch=0;github=null;}
    for(const k of ['notifications','autoStart','alwaysOnTop']) if(typeof data.settings?.[k]==='boolean')s[k]=data.settings[k];
    if([48,56,64,72,84,100,112].includes(Number(data.settings?.avatarSize)))s.avatarSize=Number(data.settings.avatarSize);
    // null resets the panel to the compact default; invalid sizes are ignored.
    if(data.settings&&'panelSize' in data.settings)s.panelSize=normalizePanelSize(data.settings.panelSize);
    state.settings=s;save();if(data.settings?.repo)refreshGithub(true).catch(()=>{});return s;
  }
  if(key==='schedule:action'){
    const item=state.schedule.find(x=>x.id===data.id);
    if(!item)throw Error('Zadanie nie istnieje');
    const today=dayKey(new Date());
    if(data.action==='snooze'){
      item.snoozeUntil=new Date(Date.now()+600_000).toISOString();
      activity('Przełożono: '+item.title+' (+10 min)');
    }else if(data.action==='dismiss'){
      item.snoozeUntil=null;
      activity('Pominięto: '+item.title);
    }else if(data.action==='start'){
      item.snoozeUntil=null;
      state.reminded[`${today}:${item.id}:base`]=true;
      // 'started' is the user's own click: logged, but not echoed as a Windows toast.
      activity('Rozpoczęto: '+item.title,'reminder',item.id,'started');
      if(item.target)await openTarget(item.kind,item.target);
    }else if(data.action==='finish'){
      state.reminded[`${today}:${item.id}:end`]=true;
      item.completedDates=[...new Set([...(item.completedDates||[]),today])].sort().slice(-365);
      activity('Zakończono: '+item.title,'reminder',item.id,'finished');
    }else throw Error('Nieznana akcja');
    save();return true;
  }
  if(key==='notification:test'){
    if(!state.settings.notifications)return {queued:false,notificationsEnabled:false};
    const event=activity('Ratchet działa. To jest próbny dymek i powiadomienie Windows.','reminder','','test');
    return {queued:true,id:event.id,notificationsEnabled:true};
  }
  if(key==='notification:delivery'){
    const entry=state.activity.find(x=>x.id===String(data.id||''));
    if(!entry||entry.level!=='reminder')throw Error('Nie znaleziono powiadomienia');
    // A call to ShowBalloonTip is only an attempted Windows notification, not proof of visibility.
    entry.delivery={windowsAttempted:data.windowsAttempted===true,bubbleShown:data.bubbleShown===true,at:new Date().toISOString()};
    save();return entry.delivery;
  }
  if(key==='notification:status'){
    const entry=state.activity.find(x=>x.id===String(data.id||''));
    return {found:!!entry,delivery:entry?.delivery||null};
  }
  if(key==='notification:open'){
    const entry=state.activity.find(x=>x.id===String(data.id||''));
    const task=entry?.taskId&&state.schedule.find(x=>x.id===entry.taskId);
    if(task?.target)return openTarget(task.kind,task.target);
    panelRequests++;return {panelRequested:true};
  }
  if(key==='open-target')return openTarget(data.kind,data.target);
  if(key==='handoff')return handoffText(state,github);
  if(key==='panel:show'){ panelRequests++; return true; }
  if(key==='panel:hide'){ panelHideRequests++; return true; }
  if(key==='orb:reset'){ orbResetRequests++; state.orbPosition=null; save(); return true; }
  if(key==='orb:position'){
    const x=Math.round(Number(data.x)),y=Math.round(Number(data.y));
    if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>20000||Math.abs(y)>20000)throw Error('Niepoprawna pozycja');
    state.orbPosition={x,y};save();return state.orbPosition;
  }
  if(key==='diagnostics:run'){
    // Fixed command, no user-supplied shell arguments, no data uploaded.
    if(process.platform!=='win32')throw Error('Diagnostyka natywna działa wyłącznie na Windows');
    const script=path.join(__dirname,'Diagnostyka-Ratchet.ps1');
    if(!fs.existsSync(script))throw Error('Brak modułu diagnostyki Ratcheta');
    // Ratchet.exe runs the script in-process (no flagged powershell command line).
    const exe=path.join(__dirname,'Ratchet.exe');
    const child=fs.existsSync(exe)
      ? spawn(exe,['--diagnostics'],{detached:true,windowsHide:true,stdio:'ignore'})
      : spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{detached:true,windowsHide:true,stdio:'ignore'});
    child.on('error',e=>console.error('[ratchet] Diagnostics launch:',e.message));
    child.unref();
    return {requested:true,localOnly:true};
  }
  if(key==='update:check'){
    updateAvailable = await checkUpdate();
    return updateAvailable;
  }
  if(key==='update:install'){
    if(installingUpdate)throw Error('Aktualizacja już trwa');
    installingUpdate=true;
    try {
      const candidate=await checkUpdate();
      if(!candidate.available)throw Error('Nie ma nowszej wersji');
      const staged=await stageUpdate(candidate);
      const ps=spawn('powershell.exe',[
        '-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'Apply-Ratchet-Update.ps1'),
        '-AppRoot',__dirname,'-Staging',staged,'-ServerProcessId',String(process.pid),'-ExpectedVersion',candidate.version
      ],{windowsHide:true,detached:true,stdio:'ignore'});
      ps.on('error',e=>console.error('Ratchet updater:',e.message));
      ps.unref();
      quitRequested=true;
      coordinatorRunner.stop();
      setTimeout(()=>{shuttingDown=true;appServer?.close();hookServer?.close();setTimeout(()=>process.exit(0),400).unref();},3000).unref();
      return {started:true,version:candidate.version};
    } catch(e) {installingUpdate=false;throw e;}
  }
  if(key==='github:refresh')return refreshGithub(true);
  if(key==='quit') {
    if(!quitRequested) {
      quitRequested=true;
      coordinatorRunner.stop();
      // Give the Windows mascot a chance to see the quit signal and close.
      setTimeout(()=>{
        shuttingDown=true;
        appServer?.close();hookServer?.close();
        setTimeout(()=>process.exit(0),400).unref();
      },6000).unref();
    }
    return true;
  }
  throw Error('Nieznana akcja');
}
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
function staticResponse(url,res){
  if(url==='/'||url==='/panel'){res.writeHead(302,{Location:'/ui/panel.html'});res.end();return;}
  const relative=url.replace(/^\/ui\//,'');
  if(!url.startsWith('/ui/')){res.writeHead(404);res.end();return;}
  const target=path.resolve(UI_ROOT,relative);
  if(!target.startsWith(UI_ROOT+path.sep)){res.writeHead(403);res.end();return;}
  try {
    const data=fs.readFileSync(target);
    res.writeHead(200,{'Content-Type':TYPES[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(data);
  } catch {res.writeHead(404);res.end('Nie znaleziono pliku');}
}
async function appRequest(req,res) {
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return fail(res,'Tylko localhost',403);
  const url=new URL(req.url,`http://127.0.0.1:${PORT}`);
  if(req.method==='GET'){
    if(url.pathname==='/api/ping') return json(res,{ok:true,version:CURRENT_VERSION,commit:BUILD.commit,root:__dirname,pid:process.pid,quitting:quitRequested});
    if(url.pathname==='/api/snapshot') return json(res,snapshot());
    if(url.pathname==='/api/status') return json(res,{status:health(),quitRequested,avatarSize:state.settings.avatarSize,alwaysOnTop:state.settings.alwaysOnTop!==false,autoStart:state.settings.autoStart===true,panelSize:state.settings.panelSize||null,orbPosition:state.orbPosition||null,panelRequests,panelHideRequests,orbResetRequests,activity:state.activity.filter(x=>x.level==='reminder').slice(0,20),notifications:state.settings.notifications});
    return staticResponse(url.pathname,res);
  }
  if(req.method==='POST'&&url.pathname==='/api/action'){
    if(!acceptPost(req)) return fail(res,'Nieautoryzowane żądanie',403);
    try {const body=await bodyOf(req); return json(res,{ok:true,result:await handleAction(body.action,body.data||{})});}
    catch(e) {return fail(res,e.message||'Nieznany błąd');}
  }
  return fail(res,'Nie znaleziono',404);
}
function startHookServer() {
  hookServer=http.createServer((req,res)=>{
    if(req.method!=='POST'||req.url!=='/hook')return res.writeHead(404).end();
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.writeHead(403).end();
    bodyOf(req).then(data=>{
      const event=String(data.hook_event_name||'').slice(0,70);
      const session=String(data.session_id||'').slice(0,100);
      if(!session||!['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Stop','StopFailure','Notification','SessionEnd'].includes(event))throw Error('Niepoprawne zdarzenie');
      const id='claude:'+session,index=state.agents.findIndex(x=>x.id===id),prev=index>=0?state.agents[index]:null;
      const status=event==='StopFailure'?'blocked':event==='Stop'||event==='Notification'?'needs_attention':event==='SessionEnd'?'idle':'working';
      const clean=normalizeItem('agents',{...prev,id,title:prev?.title||'Claude · '+session.slice(0,8),tool:'Claude Code',status,source:'hook',kind:'folder',target:String(data.cwd||prev?.target||''),note:event==='Stop'?'Odpowiedź zakończona — CI i wdrożenie niezweryfikowane':'Zdarzenie: '+event,updatedAt:new Date().toISOString()});
      if(index>=0)state.agents[index]=clean;else state.agents.unshift(clean);
      state.agents=state.agents.slice(0,100);save();
      // Notification and Stop may share the same needs_attention status.
      // Compare the last hook event instead: never suppress a real Stop after Notification,
      // but don't notify twice for a repeated Stop callback.
      const coordId=String(data.coordinator_job_id||'').slice(0,80);
      const coordinated=coordId&&state.coordinator.jobs.some(j=>j.id===coordId&&(j.status==='running'||j.status==='queued'));
      // Coordinator-owned stages report through the runner, not duplicate human Stop alerts.
      if(!coordinated&&(event==='Stop'||event==='StopFailure')&&prev?.note!==clean.note){
        activity(event==='StopFailure'
          ? 'Claude Code zgłosił błąd: '+clean.title+'. Sprawdź sesję.'
          : 'Claude Code zakończył odpowiedź: '+clean.title+'. Zmiany nie są jeszcze zweryfikowane.',
          'reminder','',event==='StopFailure'?'agent-failure':'agent');
      }
      res.writeHead(204);res.end();
    }).catch(()=>{res.writeHead(400);res.end();});
  });
  hookServer.on('error',e=>console.warn('[ratchet] Hook server:',e.message));
  hookServer.listen(CLAUDE_PORT,'127.0.0.1');
}
function main(){
  read();coordinatorRunner.reconcile();checkSchedule();
  appServer=http.createServer((req,res)=>{appRequest(req,res).catch(e=>fail(res,e.message,500));});
  appServer.on('error',e=>{console.error('[ratchet] Server:',e.message);process.exit(1);});
  appServer.listen(PORT,'127.0.0.1',()=>console.log('Ratchet '+CURRENT_VERSION+' start: http://127.0.0.1:'+PORT+' commit '+(BUILD.commit||'dev')));
  if(process.env.RATCHET_DISABLE_HOOKS!=='1')startHookServer();
  setInterval(checkSchedule,15000);
  setInterval(()=>coordinatorRunner.tick(),4000);
  coordinatorRunner.tick();
  refreshGithub(true).catch(e=>console.warn('GitHub:',e.message));
  setInterval(()=>refreshGithub().catch(()=>{}),60000);
}
if(require.main===module) main();
module.exports={read,save,snapshot,health,checkSchedule,handleAction,openTarget,appRequest,main,coordinatorRunner};
