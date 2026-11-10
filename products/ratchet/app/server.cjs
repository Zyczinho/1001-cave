'use strict';
// Ratchet 0.2: localhost-only companion for Windows, no Electron, no npm install.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {CURRENT_VERSION,checkUpdate,stageUpdate} = require('./updater.cjs');
const {defaults, normalizeStore, normalizeItem, dueTasks, dayKey, validateTarget, mergeRepoData, handoffText} = require('./core.cjs');

const PORT = Number(process.env.RATCHET_PORT || 47823);
const CLAUDE_PORT = Number(process.env.RATCHET_HOOK_PORT || 47822);
const DATA = path.join(process.env.APPDATA || path.join(os.homedir(), '.ratchet'), 'Ratchet', 'ratchet.json');
const UI_ROOT = path.resolve(__dirname, 'ui');
const JSON_LIMIT = 64 * 1024;
let state = defaults(), github = null, githubError = null, lastFetch = 0;
let appServer, hookServer, shuttingDown = false, quitRequested = false;
let panelRequests = 0, installingUpdate = false, updateAvailable = null;

function read() {
  if (!fs.existsSync(DATA)) { state=defaults(); return; }
  try {state=normalizeStore(JSON.parse(fs.readFileSync(DATA,'utf8')));}
  catch(e) {
    console.error('[ratchet] Uszkodzony profil:',e.message);
    const previous=DATA+'.bak';
    try {
      state=normalizeStore(JSON.parse(fs.readFileSync(previous,'utf8')));
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
function activity(message, level='info', taskId='') { state.activity.unshift({id: String(Date.now()) + Math.random(),text:message,level,taskId,at:new Date().toISOString()}); state.activity = state.activity.slice(0,80); save(); }
function checkSchedule() {
  const now = new Date(); let updated = false;
  for(const task of dueTasks(state, now)) {
    state.reminded[`${dayKey(now)}:${task.id}:${task.snoozeUntil||'base'}`] = true;
    state.activity.unshift({id:String(Date.now())+task.id,text:`Czas na: ${task.title} (${task.time}). Działasz?`,at:now.toISOString(),level:'reminder',taskId:task.id});
    updated = true;
  }
  if(updated) {state.activity=state.activity.slice(0,80); save();}
}
function health() {
  const a=state.agents;
  const runs=github?.runs||[];
  const failed=runs.some(x=>x.status==='completed'&&['failure','timed_out','action_required'].includes(x.conclusion));
  const blocked=a.some(x=>x.status==='blocked');
  const attention=a.some(x=>x.status==='needs_attention')||(github?.overlapping||[]).length>0;
  const working=a.some(x=>x.status==='working')||runs.some(x=>x.status!=='completed');
  return failed||blocked?'blocked':attention?'needs_attention':working?'working':runs.some(x=>x.conclusion==='success')?'ready':'idle';
}
function snapshot() {return {state,github,githubError,platform:process.platform};}
async function refreshGithub(force=false) {
  if(!force && Date.now()-lastFetch<10*60_000) return {github,githubError};
  const repo=state.settings.repo||'';
  if(!/^[-\w.]+\/[-\w.]+$/.test(repo)) {githubError='Repo powinno mieć format właściciel/nazwa';return {github,githubError};}
  lastFetch=Date.now();
  try {
    const headers={'Accept':'application/vnd.github+json','User-Agent':'Ratchet/0.2.7','X-GitHub-Api-Version':'2022-11-28'};
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
  const targetCommand = "Start-Process -FilePath '" + t.replaceAll("'", "''") + "'";
  // EncodedCommand avoids cmd.exe quoting and shell injection.
  const encoded=Buffer.from(targetCommand,'utf16le').toString('base64');
  const proc=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,stdio:'ignore',detached:true});
  proc.on('error',e=>console.error('Launch:',e.message));proc.unref();
  return Promise.resolve({opened:true});
}
async function handleAction(key,data) {
  if(key==='item:save'){
    if(!['schedule','links','agents'].includes(data.collection)) throw Error('Nieznana kolekcja');
    const clean=normalizeItem(data.collection,data.item);
    const i=state[data.collection].findIndex(x=>x.id===clean.id);
    if(i>=0)state[data.collection][i]=clean;else state[data.collection].push(clean);
    save();return clean;
  }
  if(key==='item:remove'){
    if(!['schedule','links','agents'].includes(data.collection)) throw Error('Nieznana kolekcja');
    state[data.collection]=state[data.collection].filter(x=>x.id!==data.id);save();return true;
  }
  if(key==='settings:save'){
    const s={...state.settings};
    if(typeof data.settings?.repo==='string'&&/^[-\w.]+\/[-\w.]+$/.test(data.settings.repo.trim())){s.repo=data.settings.repo.trim();lastFetch=0;github=null;}
    for(const k of ['notifications','autoStart','alwaysOnTop']) if(typeof data.settings?.[k]==='boolean')s[k]=data.settings[k];
    if([72,84,100,112].includes(Number(data.settings?.avatarSize)))s.avatarSize=Number(data.settings.avatarSize);
    state.settings=s;save();if(data.settings?.repo)refreshGithub(true).catch(()=>{});return s;
  }
  if(key==='schedule:action'){
    const item=state.schedule.find(x=>x.id===data.id);
    if(!item)throw Error('Zadanie nie istnieje');
    if(data.action==='snooze'){item.snoozeUntil=new Date(Date.now()+600_000).toISOString();activity('Przełożono: '+item.title+' (+10 min)');}
    else if(data.action==='dismiss'){item.snoozeUntil=null;activity('Pominięto: '+item.title);}
    else if(data.action==='start'){item.snoozeUntil=null;activity('Rozpoczęto: '+item.title,'success');if(item.target)await openTarget(item.kind,item.target);}
    else throw Error('Nieznana akcja');save();return true;
  }
  if(key==='open-target')return openTarget(data.kind,data.target);
  if(key==='handoff')return handoffText(state,github);
  if(key==='panel:show'){ panelRequests++; return true; }
  if(key==='diagnostics:run'){
    // Fixed command, no user-supplied shell arguments, no data uploaded.
    if(process.platform!=='win32')throw Error('Diagnostyka natywna działa wyłącznie na Windows');
    const script=path.join(__dirname,'Diagnostyka-Ratchet.ps1');
    if(!fs.existsSync(script))throw Error('Brak modułu diagnostyki Ratcheta');
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],
      {detached:true,windowsHide:false,stdio:'ignore'});
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
      setTimeout(()=>{shuttingDown=true;appServer?.close();hookServer?.close();setTimeout(()=>process.exit(0),400).unref();},3000).unref();
      return {started:true,version:candidate.version};
    } catch(e) {installingUpdate=false;throw e;}
  }
  if(key==='github:refresh')return refreshGithub(true);
  if(key==='quit') {
    if(!quitRequested) {
      quitRequested=true;
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
    if(url.pathname==='/api/ping') return json(res,{ok:true,version:'0.2.7'});
    if(url.pathname==='/api/snapshot') return json(res,snapshot());
    if(url.pathname==='/api/status') return json(res,{status:health(),quitRequested,avatarSize:state.settings.avatarSize,panelRequests,activity:state.activity.filter(x=>x.level==='reminder').slice(0,12),notifications:state.settings.notifications});
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
      state.agents=state.agents.slice(0,100);save();res.writeHead(204);res.end();
    }).catch(()=>{res.writeHead(400);res.end();});
  });
  hookServer.on('error',e=>console.warn('[ratchet] Hook server:',e.message));
  hookServer.listen(CLAUDE_PORT,'127.0.0.1');
}
function main(){
  read();checkSchedule();
  appServer=http.createServer((req,res)=>{appRequest(req,res).catch(e=>fail(res,e.message,500));});
  appServer.on('error',e=>{console.error('[ratchet] Server:',e.message);process.exit(1);});
  appServer.listen(PORT,'127.0.0.1',()=>console.log('Ratchet 0.2.7 start: http://127.0.0.1:'+PORT));
  if(process.env.RATCHET_DISABLE_HOOKS!=='1')startHookServer();
  setInterval(checkSchedule,15000);
  refreshGithub(true).catch(e=>console.warn('GitHub:',e.message));
  setInterval(()=>refreshGithub().catch(()=>{}),60000);
}
if(require.main===module) main();
module.exports={read,save,snapshot,health,handleAction,openTarget,appRequest,main};
