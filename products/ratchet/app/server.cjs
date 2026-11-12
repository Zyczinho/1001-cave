'use strict';
// Ratchet 0.2: localhost-only companion for Windows, no Electron, no npm install.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {makeJob,CoordinatorRunner}=require('./coordinator.cjs');
const {ChatGPTWorkspaceWatcher}=require('./chatgpt-workspace.cjs');
const {startSignal,updateSignal}=require('./chatgpt-signal.cjs');
const {Journal,readEvents,daySummary,claudeType,chatgptType}=require('./journal.cjs');
const {CURRENT_VERSION,checkUpdate,stageUpdate} = require('./updater.cjs');
const {defaults, normalizeStore, normalizePanelSize, normalizeItem, dueTasks, dueEndTasks, dayKey, validateTarget, mergeRepoData, handoffText, agentHookOutcome, projectName, parseChatUrl, chatProjectName, tidyAgentRows, transcriptTitle, topicFromNote, rowWakes, browserChatOutcome, BrowserFocus, sessionLive, rowStatus, rowKey, STALE_MS} = require('./core.cjs');
// Live Claude Code sessions and ChatGPT chats (memory only). The profile keeps one row per project.
const sessions = new Map();
// The row's topic is the topic of the session or chat that spoke last.
// `status` is that session's own status: a row ended with "Zakończ" returns only when
// the session that spoke starts working or needs the person (rowWakes in core.cjs).
function upsertRow(row, {title, tool, source, kind, target, note, topic, status}) {
  if (state.hiddenRows[row]) {
    if (!rowWakes(status)) return;
    delete state.hiddenRows[row];
  }
  const members = [...sessions.values()].filter(s => s.row === row);
  const index = state.agents.findIndex(x => x.id === row), prev = index >= 0 ? state.agents[index] : null;
  const clean = normalizeItem('agents', {...prev, id: row, title, tool, status: rowStatus(members), source, kind,
    target: target || prev?.target || '', note: note || prev?.note || '', topic: topic || prev?.topic || '', updatedAt: new Date().toISOString()});
  if (index >= 0) state.agents[index] = clean; else state.agents.unshift(clean);
  state.agents = state.agents.slice(0, 100);
}
// Once a minute: a project row whose sessions went quiet stops saying "Pracuje".
function sweepRows(now = Date.now()) {
  let changed = false;
  for (const [id, s] of sessions) if (now - Date.parse(s.updatedAt || 0) > 12 * 3600 * 1000) sessions.delete(id);
  for (const agent of state.agents) {
    if (!agent.id.startsWith('project:')) continue;
    const members = [...sessions.values()].filter(s => s.row === agent.id);
    // No live sessions (e.g. after a Rachet restart): "Pracuje" and "Potrzebuje Cię"
    // left over from an earlier day must not stay on the row forever.
    const status = members.length ? rowStatus(members, now)
      : !sessionLive(agent, now) ? 'idle' : agent.status;
    if (status !== agent.status) { agent.status = status; changed = true; }
  }
  // Scratch chats, nameless ChatGPT project rows and long-resting rows (see core.cjs).
  const tidy = tidyAgentRows(state.agents, now);
  if (tidy.length !== state.agents.length || tidy.some((a, i) => a !== state.agents[i])) { state.agents = tidy; changed = true; }
  return changed;
}

const PORT = Number(process.env.RATCHET_PORT || 47823);
const CLAUDE_PORT = Number(process.env.RATCHET_HOOK_PORT || 47822);
const DATA = path.join(process.env.APPDATA || path.join(os.homedir(), '.ratchet'), 'Ratchet', 'ratchet.json');
const UI_ROOT = path.resolve(__dirname, 'ui');
const JSON_LIMIT = 64 * 1024;
// Local event log for task timing (no prompt text). Off with RATCHET_DISABLE_JOURNAL=1.
const journal = new Journal({dir: path.join(path.dirname(DATA), 'dziennik'), enabled: process.env.RATCHET_DISABLE_JOURNAL !== '1'});
let state = defaults(), github = null, githubError = null, lastFetch = 0;
let appServer, hookServer, shuttingDown = false, quitRequested = false;
let panelRequests = 0, panelHideRequests = 0, orbResetRequests = 0, focusRequests = 0, focusFolder = '', installingUpdate = false, updateAvailable = null;
const coordinatorRunner=new CoordinatorRunner({
  getState:()=>state.coordinator,persist:()=>save(),
  notify:(message,level,taskId,phase)=>activity(message,level,taskId,phase)
});
const chatgptWatcher=new ChatGPTWorkspaceWatcher({
  getJobs:()=>state.chatgptRuns,persist:()=>save(),
  token:process.env.RATCHET_WORKSPACE_AGENT_TOKEN||'',
  notify:(message,level,taskId,phase,target)=>{
    const entry=activity(message,level,taskId,phase);
    if(target){entry.target=target;save();}
  }
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
function activity(message, level='info', taskId='', phase='', extra={}) {
  const entry={id: String(Date.now()) + Math.random(),text:message,level,taskId,phase,at:new Date().toISOString(),...extra};
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
  const monitored=state.chatgptRuns||[];
  const signals=state.chatgptSignals||[];
  const runs=github?.runs||[];
  const failed=runs.some(x=>x.status==='completed'&&['failure','timed_out','action_required'].includes(x.conclusion));
  const blocked=a.some(x=>x.status==='blocked')||coordinator.some(x=>x.status==='attention')||monitored.some(x=>x.status==='failed'||x.status==='attention')||signals.some(x=>x.status==='needs_attention');
  const attention=a.some(x=>x.status==='needs_attention')||(github?.overlapping||[]).length>0;
  const working=a.some(x=>x.status==='working')||coordinator.some(x=>x.status==='running')||monitored.some(x=>['queued','in_progress','suspended','submitting'].includes(x.status))||signals.some(x=>x.status==='working')||runs.some(x=>x.status!=='completed');
  return failed||blocked?'blocked':attention?'needs_attention':working?'working':runs.some(x=>x.conclusion==='success')?'ready':'idle';
}
// Today's time summary for the Dziś tab (E2), re-counted at most every 30 seconds.
let dayCache={at:0,value:null};
function today(now=Date.now()){
  if(now-dayCache.at<30000)return dayCache.value;
  const midnight=new Date(now);midnight.setHours(0,0,0,0);
  let value=null;
  try{value=daySummary(readEvents(journal.dir,{from:midnight.toISOString()}),now);}catch{}
  dayCache={at:now,value};
  return value;
}
function snapshot() {return {state,github,githubError,platform:process.platform,chatgptWorkspaceReady:chatgptWatcher.isConfigured(),today:today()};}
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
const browserFocus=new BrowserFocus();
// A ChatGPT chat: the extension brings the tab that already holds it to the front.
// Without the extension Rachet opens the address, which makes a new tab.
function showChat(url) {
  if(browserFocus.request(url)) return Promise.resolve({focus:'browser'});
  return openTarget('url',url);
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
  if(key==='chatgpt:signal-start'){
    const {signal}=startSignal(state.chatgptSignals,data);save();
    return {id:signal.id,status:signal.status};
  }
  if(key==='chatgpt:signal-complete'||key==='chatgpt:signal-attention'){
    const {signal,changed}=updateSignal(state.chatgptSignals,{
      ...data,status:key==='chatgpt:signal-complete'?'reported_done':'needs_attention'
    });
    if(changed){
      save();
      const message=key==='chatgpt:signal-complete'
        ? 'ChatGPT zgłosił ukończenie: '+signal.title+'. Sprawdź odpowiedź i rezultat.'
        : 'ChatGPT zgłosił blokadę: '+signal.title+'. '+signal.note;
      const event=activity(message,'reminder','',key==='chatgpt:signal-complete'?'chatgpt-signal':'chatgpt-signal-attention');
      if(signal.conversationUrl){event.target=signal.conversationUrl;save();}
    }
    return {id:signal.id,status:signal.status,changed};
  }
  if(key==='chatgpt:signal-remove'){
    const id=String(data.id||'');
    const signal=state.chatgptSignals.find(x=>x.id===id);
    if(!signal)throw Error('Nie znaleziono sygnału.');
    if(signal.status==='working')throw Error('Wpis jest aktywny. Zakończ zadanie lub zgłoś blokadę.');
    state.chatgptSignals=state.chatgptSignals.filter(x=>x.id!==id);save();return true;
  }
  if(key==='chatgpt:create')return chatgptWatcher.create(data);
  if(key==='chatgpt:refresh'){await chatgptWatcher.poll();return {ok:true};}
  if(key==='chatgpt:resume')return chatgptWatcher.resumeMonitoring(String(data.id||''));
  if(key==='chatgpt:remove')return chatgptWatcher.remove(String(data.id||''));
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
    // An agent alert leads to the agent: the orb brings the Claude window forward,
    // or opens the project folder when Claude is not running.
    if(entry?.agentId){
      const agent=state.agents.find(x=>x.id===entry.agentId);
      // A ChatGPT chat reopens exactly that conversation (validated chatgpt.com URL only).
      if(agent?.source==='browser'&&parseChatUrl(agent.target))return showChat(agent.target);
      return {focus:'claude',folder:agent?.kind==='folder'?agent.target:''};
    }
    // Notification actions may open only verified ChatGPT conversation URLs, never arbitrary links.
    if(entry?.target && (/^https:\/\/chatgpt\.com\/c\/[\w-]+\/?$/.test(entry.target)||parseChatUrl(entry.target)))
      return parseChatUrl(entry.target)?showChat(entry.target):openTarget('url',entry.target);
    panelRequests++;return {panelRequested:true};
  }
  if(key==='open-target')return data.kind==='url'&&parseChatUrl(data.target)?showChat(data.target):openTarget(data.kind,data.target);
  if(key==='agent:finish'){
    // "Zakończ": the row leaves the list and stays away until that work starts again.
    // Only rows Rachet made itself; manual agents are removed through edit.
    const id=String(data.id||'');
    const agent=state.agents.find(x=>x.id===id&&id.startsWith('project:'));
    if(!agent)throw Error('Nie ma takiego agenta');
    state.agents=state.agents.filter(x=>x!==agent);
    state.hiddenRows[id]=new Date().toISOString();
    const ids=Object.keys(state.hiddenRows);
    for(const old of ids.slice(0,Math.max(0,ids.length-200)))delete state.hiddenRows[old];
    save();return true;
  }
  if(key==='agent:focus'){
    // The panel cannot raise another app's window; the orb does it on its next tick.
    const agent=state.agents.find(x=>x.id===String(data.id||''));
    if(!agent)throw Error('Nie ma takiego agenta');
    focusFolder=agent.kind==='folder'?agent.target:'';focusRequests++;
    return {focusRequested:true};
  }
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
// Only a browser extension on this computer, sending the Rachet marker and JSON.
function fromExtension(req) {
  return /^(?:chrome-)?extension:\/\/[a-p]{32}$/.test(String(req.headers.origin||''))&&req.headers['x-ratchet-local']==='1'&&(req.headers['content-type']||'').startsWith('application/json');
}
async function appRequest(req,res) {
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return fail(res,'Tylko localhost',403);
  const url=new URL(req.url,`http://127.0.0.1:${PORT}`);
  if(req.method==='GET'){
    if(url.pathname==='/api/ping') return json(res,{ok:true,version:CURRENT_VERSION,commit:BUILD.commit,root:__dirname,pid:process.pid,quitting:quitRequested});
    if(url.pathname==='/api/snapshot') return json(res,snapshot());
    if(url.pathname==='/api/status') return json(res,{status:health(),quitRequested,avatarSize:state.settings.avatarSize,alwaysOnTop:state.settings.alwaysOnTop!==false,autoStart:state.settings.autoStart===true,panelSize:state.settings.panelSize||null,orbPosition:state.orbPosition||null,panelRequests,panelHideRequests,orbResetRequests,focusRequests,focusFolder,activity:state.activity.filter(x=>x.level==='reminder').slice(0,20),notifications:state.settings.notifications});
    return staticResponse(url.pathname,res);
  }
  // Narrow door for the Rachet Edge extension: it can only report a ChatGPT chat
  // working/done/closed. It cannot reach any other action (open, quit, settings...).
  if(req.method==='POST'&&url.pathname==='/api/browser-signal'){
    if(!fromExtension(req)) return fail(res,'Nieautoryzowane żądanie',403);
    try {
      const body=await bodyOf(req);
      // An address without the project name still belongs to its named project row.
      const project=chatProjectName(body.url,[...state.agents,...sessions.values()].map(a=>a.target));
      const out=browserChatOutcome(body,{agents:[...sessions.values()],project});
      const name=project||'ChatGPT',row=rowKey('chatgpt',name);
      journal.record({src:'chatgpt',project:name,session:out.id.slice(8),type:chatgptType(body.state,sessions.get(out.id)?.status)});
      sessions.set(out.id,{id:out.id,source:'browser',status:out.status,target:out.url,note:out.title,topic:out.topic,updatedAt:new Date().toISOString(),row});
      upsertRow(row,{title:name,tool:'ChatGPT',source:'browser',kind:'url',target:out.url,note:out.title,topic:out.topic,status:out.status});
      save();
      // The alert opens the conversation that finished, even if the row moves on.
      if(out.alert)activity(out.alert.text,'reminder','',out.alert.phase,{agentId:row,target:out.url});
      const status=state.agents.find(x=>x.id===row)?.status;
      return json(res,{ok:true,row,status,notified:!!out.alert});
    } catch(e) {return fail(res,e.message||'Niepoprawny sygnał');}
  }
  // The extension waits here for "show this chat". It gets a chat address and nothing else.
  if(req.method==='POST'&&url.pathname==='/api/browser-focus'){
    if(!fromExtension(req)) return fail(res,'Nieautoryzowane żądanie',403);
    const waiting=browserFocus.wait();
    res.on('close',()=>waiting.cancel());
    return json(res,{url:await waiting});
  }
  if(req.method==='POST'&&url.pathname==='/api/action'){
    if(!acceptPost(req)) return fail(res,'Nieautoryzowane żądanie',403);
    try {const body=await bodyOf(req); return json(res,{ok:true,result:await handleAction(body.action,body.data||{})});}
    catch(e) {return fail(res,e.message||'Nieznany błąd');}
  }
  return fail(res,'Nie znaleziono',404);
}
// Claude Code reports the folder it is in, often a subfolder. Name and open the project
// by its git root (a worktree's root counts) so "app" never stands for "1001-cave".
function projectRoot(cwd){
  let dir=cwd;
  for(let i=0;i<10&&dir;i++){
    try{if(fs.existsSync(path.join(dir,'.git')))return dir;}catch{return cwd;}
    const up=path.dirname(dir);
    if(up===dir)break;
    dir=up;
  }
  return cwd;
}
// The Claude session title, read from the end of the session file (the title repeats
// through the file). Only session files under ~/.claude/projects are read, nothing else.
const CLAUDE_PROJECTS=path.join(os.homedir(),'.claude','projects');
function sessionTitle(file){
  try{
    const full=path.resolve(file);
    if(!file||path.extname(full).toLowerCase()!=='.jsonl'||!full.toLowerCase().startsWith(CLAUDE_PROJECTS.toLowerCase()+path.sep))return '';
    const size=fs.statSync(full).size,chunk=256*1024,fd=fs.openSync(full,'r');
    try{
      const read=(at,len)=>{const b=Buffer.alloc(len);fs.readSync(fd,b,0,len,at);return b.toString('utf8');};
      return transcriptTitle(read(Math.max(0,size-chunk),Math.min(size,chunk)))
        ||(size>chunk?transcriptTitle(read(0,chunk)):'');
    }finally{fs.closeSync(fd);}
  }catch{return '';}
}
function startHookServer() {
  hookServer=http.createServer((req,res)=>{
    if(req.method!=='POST'||req.url!=='/hook')return res.writeHead(404).end();
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.writeHead(403).end();
    bodyOf(req).then(data=>{
      const event=String(data.hook_event_name||'').slice(0,70);
      const session=String(data.session_id||'').slice(0,100);
      if(!session||!['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Stop','StopFailure','Notification','SessionEnd'].includes(event))throw Error('Niepoprawne zdarzenie');
      const id='claude:'+session,prev=sessions.get(id)||null;
      const cwd=projectRoot(String(data.cwd||prev?.target||''));
      const name=projectName(cwd)||'Claude Code',row=rowKey('claude',name);
      const outcome=agentHookOutcome(event,{agents:[...sessions.values()],id,prev,cwd,
        notificationType:String(data.notification_type||'').slice(0,40),message:String(data.message||'').slice(0,200)});
      journal.record({src:'claude',project:name,session,type:claudeType(event,outcome.status)});
      // Tool calls come often; the title is re-read only when it can have changed.
      const topic=['SessionStart','UserPromptSubmit','Stop'].includes(event)||!prev?.topic
        ?sessionTitle(String(data.transcript_path||''))||prev?.topic||'':prev.topic;
      sessions.set(id,{id,source:'hook',status:outcome.status,target:cwd,note:outcome.note,topic,updatedAt:new Date().toISOString(),row});
      upsertRow(row,{title:name,tool:'Claude Code',source:'hook',kind:'folder',target:cwd,note:outcome.note,topic,status:outcome.status});
      save();
      const coordId=String(data.coordinator_job_id||'').slice(0,80);
      const coordinated=coordId&&state.coordinator.jobs.some(j=>j.id===coordId&&(j.status==='running'||j.status==='queued'));
      // Coordinator-owned stages report through the runner, not duplicate human alerts.
      // agentHookOutcome stays silent while other agents in the same project still work.
      if(!coordinated&&outcome.alert)activity(outcome.alert.text,'reminder','',outcome.alert.phase,{agentId:row});
      res.writeHead(204);res.end();
    }).catch(()=>{res.writeHead(400);res.end();});
  });
  hookServer.on('error',e=>console.warn('[ratchet] Hook server:',e.message));
  hookServer.listen(CLAUDE_PORT,'127.0.0.1');
}
// Rows saved before topics existed get one on start, so every row reads the same way:
// ChatGPT from the chat title already kept in the note, Claude from the newest session
// file of that folder (Claude names the folder by replacing every non-letter with "-").
function fillTopics(){
  let changed=false;
  for(const a of state.agents){
    if(a.topic||!a.id.startsWith('project:'))continue;
    let topic='';
    if(a.source==='browser')topic=topicFromNote(a.note,a.title);
    else if(a.source==='hook'&&a.target){
      try{
        const dir=path.join(CLAUDE_PROJECTS,a.target.replace(/[^A-Za-z0-9]/g,'-'));
        const newest=fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl'))
          .map(f=>({f,t:fs.statSync(path.join(dir,f)).mtimeMs})).sort((x,y)=>y.t-x.t)[0];
        if(newest)topic=sessionTitle(path.join(dir,newest.f));
      }catch{}
    }
    if(topic){a.topic=topic.slice(0,120);changed=true;}
  }
  return changed;
}
function main(){
  read();
  // Older versions kept one row per session or chat; the panel now groups them by project.
  const before=state.agents.length;
  // Session rows are recognised by their id too: 0.2.9 builds saved ChatGPT rows as "manual".
  state.agents=state.agents.filter(a=>a.id.startsWith('project:')||!(['hook','browser'].includes(a.source)||/^(?:claude|chatgpt):/.test(a.id)));
  const filled=fillTopics();
  if(sweepRows()||filled||state.agents.length!==before)save();
  setInterval(()=>{if(sweepRows())save();},60000).unref();coordinatorRunner.reconcile();checkSchedule();
  appServer=http.createServer((req,res)=>{appRequest(req,res).catch(e=>fail(res,e.message,500));});
  appServer.on('error',e=>{console.error('[ratchet] Server:',e.message);process.exit(1);});
  appServer.listen(PORT,'127.0.0.1',()=>console.log('Ratchet '+CURRENT_VERSION+' start: http://127.0.0.1:'+PORT+' commit '+(BUILD.commit||'dev')));
  if(process.env.RATCHET_DISABLE_HOOKS!=='1')startHookServer();
  setInterval(checkSchedule,15000);
  setInterval(()=>coordinatorRunner.tick(),4000);
  setInterval(()=>chatgptWatcher.poll().catch(()=>{}),15000);
  chatgptWatcher.poll().catch(()=>{});
  coordinatorRunner.tick();
  refreshGithub(true).catch(e=>console.warn('GitHub:',e.message));
  setInterval(()=>refreshGithub().catch(()=>{}),60000);
}
if(require.main===module) main();
module.exports={read,save,snapshot,health,checkSchedule,handleAction,openTarget,appRequest,main,coordinatorRunner,chatgptWatcher,sweepRows,sessions};
