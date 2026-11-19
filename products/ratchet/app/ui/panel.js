'use strict';
const DEMO = !window.ratchet;
if(!DEMO) window.addEventListener('ratchet:connection', e=>{
  const tag=document.getElementById('backendStatus');
  if(!tag) return;
  const up=!!e.detail?.online;
  tag.classList.toggle('offline',!up);
  // Online is a quiet dot; only a broken connection earns words.
  tag.title=up?'Połączono':'Brak połączenia z Rachetem';
  tag.innerHTML='<span class="live-dot"></span>'+(up?'<span class="sr-only">Połączono</span>':' Brak połączenia');
});
// Collapsed sections keep their open/closed state across the 30-second re-render.
const openMore=new Set();
document.addEventListener('toggle',e=>{const key=e.target?.dataset?.more;if(!key)return;if(e.target.open)openMore.add(key);else openMore.delete(key);},true);
function more(key,summary,body){return '<details class="more" data-more="'+key+'"'+(openMore.has(key)?' open':'')+'><summary>'+summary+'</summary><div class="more-body">'+body+'</div></details>';}
const demoInitial={
  state:{
    settings:{repo:'Zyczinho/city-route-app',notifications:true,autoStart:false,alwaysOnTop:true,avatarSize:84},
    schedule:[],
    links:[
      {id:'cityroute',title:'City Route',kind:'url',target:'https://city-route-app.jakublojek.workers.dev',group:'Projekt'},
      {id:'github',title:'City Route · GitHub',kind:'url',target:'https://github.com/Zyczinho/city-route-app',group:'Kod'},
      {id:'cave',title:'1001 CAVE',kind:'url',target:'https://github.com/Zyczinho/1001-cave',group:'Projekt'},
      {id:'box',title:'Box2Box',kind:'url',target:'https://box2box.com.pl',group:'Sklep'},
      {id:'chatgpt',title:'ChatGPT',kind:'url',target:'https://chatgpt.com/',group:'AI'},
      {id:'claude',title:'Claude',kind:'url',target:'https://claude.ai/',group:'AI'}
    ],agents:[],coordinator:{enabled:false,jobs:[]},chatgptRuns:[],chatgptSignals:[],activity:[],reminded:{}
  },github:null,githubError:'Podgląd przeglądarkowy — monitorowanie GitHuba działa w aplikacji Windows.'
};
const loadDemo=()=>{try{return JSON.parse(localStorage.getItem('ratchet-demo'))||demoInitial;}catch{return demoInitial;}};
const persistDemo=()=>{try{localStorage.setItem('ratchet-demo',JSON.stringify(snapshot));}catch{/* Podgląd osadzony może blokować storage — wtedy działa w pamięci. */}};
let snapshot=DEMO?loadDemo():demoInitial,tab='today',toastTimer,updateInfo=null;
// "Nie teraz" on a hint hides that kind of hint for an hour (UI only, kept per viewer).
const HINT_KEY='ratchet-hint-snooze';
let hintSnooze=(()=>{try{return JSON.parse(localStorage.getItem(HINT_KEY))||{};}catch{return {};}})();
function snoozeHint(id){
  hintSnooze[id]=Date.now()+3600000;
  try{localStorage.setItem(HINT_KEY,JSON.stringify(hintSnooze));}catch{/* the hour still holds in this session */}
}
const state=()=>snapshot.state;
const $=sel=>document.querySelector(sel);
const I=(name)=>`<span class="icon-slot" data-icon="${name}"></span>`;
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const short=v=>{const s=String(v??'');return s.length>54?s.slice(0,51)+'…':s;};
const now=()=>new Date();
const dateKey=(d=now())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const weekdays=['Nd','Pn','Wt','Śr','Cz','Pt','Sb'];
const pad=n=>String(n).padStart(2,'0');
const plusMinutes=(time,minutes=60)=>{const [h,m]=String(time).split(':').map(Number);const v=Math.min(23*60+59,h*60+m+minutes);return `${pad(Math.floor(v/60))}:${pad(v%60)}`;};
const formatTime=t=>new Date(t).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'});
const formatDate=t=>new Date(t).toLocaleDateString('pl-PL',{day:'numeric',month:'long',weekday:'long'});
const todayTasks=()=>state().schedule.filter(x=>x.date?x.date===dateKey():x.days.includes(now().getDay())).sort((a,b)=>a.time.localeCompare(b.time));
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3800);}
function safe(asyncFn){Promise.resolve().then(asyncFn).catch(err=>{console.error(err);toast(err.message||'Nie udało się wykonać działania');});}
const bridge=window.ratchet||{
  snapshot:async()=>snapshot,
  onSnapshot:()=>()=>{},
  save:async(type,item)=>{const clean={...item,id:item.id||(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?crypto.randomUUID():`preview-${Date.now()}-${Math.random().toString(36).slice(2)}`),updatedAt:new Date().toISOString()};const a=state()[type];const i=a.findIndex(x=>x.id===clean.id);if(i>=0)a[i]=clean;else a.push(clean);persistDemo();return clean;},
  remove:async(type,id)=>{state()[type]=state()[type].filter(x=>x.id!==id);persistDemo();},
  clearActivity:async()=>{const removed=state().activity.length;state().activity=[];persistDemo();return {removed};},
  removeActivity:async id=>{state().activity=state().activity.filter(x=>x.id!==id);persistDemo();return {removed:1};},
  saveSettings:async data=>{state().settings={...state().settings,...data};persistDemo();},
  scheduleAction:async(id,action)=>{const t=state().schedule.find(x=>x.id===id);if(action==='snooze')t.snoozeUntil=new Date(Date.now()+600000).toISOString();if(action==='start'&&t.target)window.open(t.target,'_blank','noopener,noreferrer');persistDemo();},
  focusAgent:async()=>toast('Przejście do Claude działa w aplikacji Windows'),
  finishAgent:async id=>{state().agents=state().agents.filter(x=>x.id!==id);persistDemo();},
  guardStart:async()=>{throw Error('Strażnik działa w aplikacji Windows.');},
  guardStop:async()=>{},
  open:async(kind,target)=>{if(kind==='folder')throw Error('Otwieranie folderów działa w aplikacji Windows');if(!/^https?:\/\//.test(target))throw Error('Niepoprawny link');window.open(target,'_blank','noopener,noreferrer');},
  chatgptSignalRemove:async id=>{state().chatgptSignals=(state().chatgptSignals||[]).filter(x=>x.id!==id);persistDemo();return true;},
  chatgptCreate:async()=>{throw Error('Funkcja wymaga tokenu Workspace Agents w aplikacji Windows.');},
  chatgptRefresh:async()=>({ok:true}),
  chatgptResume:async()=>{throw Error('Wymagany token Workspace Agents.');},
  chatgptRemove:async id=>{state().chatgptRuns=(state().chatgptRuns||[]).filter(j=>j.id!==id);persistDemo();return true;},
  coordinatorCreate:async data=>{throw Error('Uruchamianie agentów działa w aplikacji Windows.');},
  coordinatorCheck:async()=>{throw Error('Sprawdzanie pracy działa w aplikacji Windows.');},
  coordinatorEnable:async enabled=>{state().coordinator.enabled=enabled;persistDemo();return {enabled};},
  coordinatorRetry:async()=>{throw Error('Uruchamianie agentów działa w aplikacji Windows.');},
  coordinatorRemove:async id=>{state().coordinator.jobs=state().coordinator.jobs.filter(j=>j.id!==id);persistDemo();},
  refineLink:async()=>{throw Error('Poprawianie linków przez Claude działa w aplikacji Windows.');},
  applyLink:async()=>{},
  undoLink:async()=>{},
  checkUpdate:async()=>({available:false,version:'0.2.9',current:'0.2.9'}),
  installUpdate:async()=>toast('Aktualizator działa w aplikacji Windows'),
  testNotification:async()=>({queued:false,notificationsEnabled:false}),
  notificationStatus:async()=>({found:false,delivery:null}),
  diagnose:async()=>{throw Error('Diagnostyka działa w aplikacji Windows');},
  hidePanel:async()=>toast('Podgląd: ukrywanie działa w aplikacji Windows'),
  quit:async()=>toast('Podgląd: wyłączanie działa w aplikacji Windows'),
  resetOrb:async()=>toast('Pozycja kuleczki działa w aplikacji Windows')
};
function health(){
  const agents=state().agents;
  const jobs=state().coordinator?.jobs||[],chatRuns=state().chatgptRuns||[],signals=state().chatgptSignals||[];
  const running=agents.filter(x=>x.status==='working').length+jobs.filter(x=>x.status==='running').length+chatRuns.filter(x=>['queued','in_progress','suspended','submitting'].includes(x.status)).length+signals.filter(x=>x.status==='working').length;
  const attention=agents.filter(x=>x.status==='needs_attention'||x.status==='blocked').length;
  return {running,attention};
}
// Sessions that stopped and wait for the owner: a question, an error or finished work.
// Longest wait first, because that one has been idle the longest (owner, 19.11).
const WAITING={needs_attention:'Pyta o decyzję',blocked:'Błąd — zajrzyj',ready:'Skończyła — zobacz'};
function waitingAgents(){
  return state().agents.filter(a=>WAITING[a.status])
    .sort((x,y)=>Date.parse(x.updatedAt||0)-Date.parse(y.updatedAt||0));
}
// The Agents tab shows a small count only when something needs the user.
function renderBadge(){
  const n=waitingAgents().length,badge=$('#agentsBadge');if(!badge)return;
  badge.hidden=!n;badge.textContent=n?String(n):'';
}
const minutesOf=t=>+String(t).slice(0,2)*60+Number(String(t).slice(3,5));
const doneToday=t=>Array.isArray(t.completedDates)&&t.completedDates.includes(dateKey());
// One answer to "what matters now": sessions waiting for you, else the current block, else the next one.
function renderNow(){
  const h=health(),nowMin=now().getHours()*60+now().getMinutes();
  const waiting=waitingAgents();
  if(waiting.length){
    // One row per session: click jumps straight into it, ✓ clears it without going there.
    return '<section class="now is-alert waiting"><div class="now-label">Czeka na Ciebie · '+waiting.length+'</div>'
      +'<div class="rows">'+waiting.map(waitingRow).join('')+'</div></section>';
  }
  const pending=todayTasks().filter(t=>t.enabled&&!doneToday(t));
  const current=pending.find(t=>minutesOf(t.time)<=nowMin&&nowMin<minutesOf(t.endTime||plusMinutes(t.time)));
  if(current){
    return '<section class="now"><div class="now-label">Teraz · do '+esc(current.endTime||plusMinutes(current.time))+'</div><h2>'+esc(current.title)+'</h2>'
      +'<div class="now-actions"><button class="btn" data-action="schedule-finish" data-id="'+esc(current.id)+'">'+I('check')+' Gotowe</button>'
      +(current.target?'<button class="btn secondary" data-action="open" data-kind="'+esc(current.kind||'url')+'" data-target="'+esc(current.target)+'">'+I('external')+' Otwórz</button>':'')
      +'</div></section>';
  }
  const next=pending.find(t=>minutesOf(t.time)>nowMin);
  const working=h.running?'<p>'+h.running+' '+(h.running===1?'agent pracuje':'agentów pracuje')+'. Dam znać, gdy skończą.</p>':'';
  if(next){
    return '<section class="now"><div class="now-label">Następne · '+esc(next.time)+'</div><h2>'+esc(next.title)+'</h2>'+working
      +'<div class="now-actions"><button class="btn secondary" data-action="schedule-start" data-id="'+esc(next.id)+'">'+I('play')+' Zacznij teraz</button></div></section>';
  }
  return '<section class="now is-calm"><div class="now-label">Spokojnie</div><h2>Nic pilnego</h2>'+(working||'<p>Dam znać, gdy coś będzie potrzebne.</p>')+'</section>';
}
// One quiet hint counted by Rachet from today's journal (nextHint in journal.cjs).
// Never while something already needs you; "Nie teraz" hides that kind for an hour.
function renderHint(){
  const h=snapshot.today?.hint;
  if(!h||waitingAgents().length||(hintSnooze[h.id]||0)>Date.now())return '';
  return '<section class="hint-card" aria-label="Podpowiedź"><div><strong>'+esc(h.title)+'</strong><p>'+esc(h.text)+'</p></div>'
    +'<button class="btn tiny ghost" data-action="hint-snooze" data-id="'+esc(h.id)+'">Nie teraz</button></section>';
}
function sectionHeader(title,subtitle,button=''){return `<div class="section-header"><div><h1>${title}</h1>${subtitle?`<p class="sub">${subtitle}</p>`:''}</div>${button}</div>`;}
function empty(title,desc,emoji='✦'){return `<div class="empty"><div class="empty-emoji">${emoji}</div><strong>${title}</strong><p>${desc}</p></div>`;}
// Compact row: time, title (click = edit), one action. Everything else lives in the edit form.
function taskRow(t,dayKeyValue=dateKey()){
  const done=Array.isArray(t.completedDates)&&t.completedDates.includes(dayKeyValue);
  const isToday=dayKeyValue===dateKey();
  const act=!isToday||!t.enabled?''
    :done?'<span class="row-done" title="Zrobione">'+I('check')+'</span>'
    :minutesOf(t.time)<=now().getHours()*60+now().getMinutes()
      ?'<button class="row-act" data-action="schedule-finish" data-id="'+esc(t.id)+'" title="Gotowe" aria-label="Oznacz jako gotowe: '+esc(t.title)+'">'+I('check')+'</button>'
      :'<button class="row-act" data-action="schedule-start" data-id="'+esc(t.id)+'" title="Zacznij teraz" aria-label="Zacznij teraz: '+esc(t.title)+'">'+I('play')+'</button>';
  const meta=[t.endTime?'do '+t.endTime:'',t.project||'',t.date===null?'co tydzień':'',!t.enabled?'wyłączone':''].filter(Boolean).join(' · ');
  return '<article class="row'+(done?' is-done':'')+(!t.enabled?' is-off':'')+'"><span class="row-time">'+esc(t.time)+'</span>'
    +'<button class="row-main" data-action="edit" data-collection="schedule" data-id="'+esc(t.id)+'" title="Edytuj"><span class="row-title">'+esc(t.title)+'</span>'+(meta?'<span class="row-meta">'+esc(meta)+'</span>':'')+'</button>'+act+'</article>';
}
function taskActions(t){
  if(Array.isArray(t.completedDates)&&t.completedDates.includes(dateKey()))
    return '<div class="task-actions"><span class="pill good">✓ Ukończone dziś</span><button class="plain-icon" data-action="edit" data-collection="schedule" data-id="'+esc(t.id)+'" title="Edytuj" aria-label="Edytuj">'+I('edit')+'</button><button class="plain-icon" data-action="remove" data-collection="schedule" data-id="'+esc(t.id)+'" title="Usuń" aria-label="Usuń">'+I('trash')+'</button></div>';
  return `<div class="task-actions"><button class="btn small" data-action="schedule-start" data-id="${esc(t.id)}">${I('play')} Działam${t.target?' · otwórz':''}</button><button class="btn secondary small" data-action="schedule-finish" data-id="${esc(t.id)}">${I('check')} Zakończ</button><button class="btn ghost small" data-action="schedule-snooze" data-id="${esc(t.id)}">+10 min</button><button class="plain-icon" aria-label="Edytuj" title="Edytuj" data-action="edit" data-collection="schedule" data-id="${esc(t.id)}">${I('edit')}</button><button class="plain-icon" aria-label="Usuń" title="Usuń" data-action="remove" data-collection="schedule" data-id="${esc(t.id)}">${I('trash')}</button></div>`;}
function renderToday(){
  const tasks=todayTasks();
  let html=renderNow()+renderHint();
  html+='<div class="list-head"><h3>Dziś'+(tasks.length?' <span>· '+tasks.filter(doneToday).length+' z '+tasks.length+' zrobione</span>':'')+'</h3><button class="btn tiny secondary" data-action="calendar-add" data-date="'+dateKey()+'">+ Dodaj</button></div>';
  html+=tasks.length?'<div class="rows">'+tasks.map(t=>taskRow(t)).join('')+'</div>'
    :'<p class="list-empty">Pusto. Kliknij „+ Dodaj”.</p>';
  html+=renderDayTime();
  // Shortcuts used to be a tab; folded here they cost one line.
  html+=more('links','Skróty · '+state().links.length,(state().links.length?renderQuickLinks():'<p class="list-empty">Dodaj link do strony, czatu albo folder.</p>')
    +'<button class="btn tiny secondary" data-action="new" data-collection="links">+ Dodaj skrót</button>');
  const recent=state().activity.slice(0,5);
  if(recent.length){
    html+=more('signals','Ostatnie sygnały · '+state().activity.length,
      recent.map(a=>'<div class="signal"><span>'+esc(a.text)+'<small>'+formatTime(a.at)+'</small></span>'
        // A guard result keeps its evidence (e2e report, screenshots): one click opens the folder.
        +(a.evidence?'<button class="plain-icon" data-action="open" data-kind="folder" data-target="'+esc(a.evidence)+'" title="Otwórz dowód" aria-label="Otwórz dowód">'+I('folder')+'</button>':'')
        +'<button class="plain-icon" data-action="activity-remove" data-id="'+esc(a.id)+'" title="Usuń sygnał" aria-label="Usuń sygnał">'+I('x')+'</button></div>').join('')
      +'<button class="btn tiny ghost" data-action="activity-clear">Wyczyść wszystkie</button>');
  }
  return html;
}

// Today's time, counted by Rachet from its local event log (journal.cjs, daySummary).
function duration(ms){
  const min=Math.round((ms||0)/60000);
  return min<60?min+' min':Math.floor(min/60)+' h'+(min%60?' '+min%60+' min':'');
}
// Day summaries are written in Claude chat (owner's choice, 12.11); the panel only shows
// today's counts. The facts behind a summary stay available as the day:review action.
function renderDayTime(){
  const d=snapshot.today;
  if(!d||!d.since)return '';
  const tile=(value,label)=>'<div class="metric"><b>'+esc(String(value))+'</b><span>'+esc(label)+'</span></div>';
  return '<div class="list-head"><h3>Czas dziś <span>· od '+formatTime(d.since)+'</span></h3></div>'
    +'<div class="day-stats">'+tile(d.projects,'projekty')+tile(d.switches,'przełączenia')
    +tile(duration(d.workMs),'agenci pracowali')+tile(duration(d.waitMs),'czekali na Ciebie')+'</div>';
}
// Links: one line each. Click the name to open; the pencil edits (delete is in the form).
function renderQuickLinks(limit){
  const items=state().links.slice(0,limit||100);
  return '<div class="rows">'+items.map(x=>'<article class="row link-row"><span class="row-icon">'+I(x.kind==='folder'?'folder':'link')+'</span>'
    +'<button class="row-main" data-action="open" data-kind="'+esc(x.kind)+'" data-target="'+esc(x.target)+'" title="Otwórz"><span class="row-title">'+esc(x.title)+'</span>'+(x.group?'<span class="row-meta">'+esc(x.group)+'</span>':'')+'</button>'
    // Only saved searches (an address with a query) get "Popraw wyniki".
    +(x.kind==='url'&&/\?./.test(x.target)?'<button class="row-act quiet-act" data-action="refine" data-id="'+esc(x.id)+'" title="Popraw wyniki" aria-label="Popraw wyniki: '+esc(x.title)+'">'+I('tune')+'</button>':'')
    +'<button class="row-act quiet-act" data-action="edit" data-collection="links" data-id="'+esc(x.id)+'" title="Edytuj" aria-label="Edytuj: '+esc(x.title)+'">'+I('edit')+'</button></article>').join('')+'</div>';
}
// "Popraw wyniki": one sentence about what is wrong, Claude proposes a new address,
// the owner sees the change and saves it (or opens it first). Nothing changes without "Zapisz".
let refineProposal=null;
function showRefine(id,note=''){
  const link=state().links.find(x=>x.id===id);if(!link)return;
  refineProposal=null;
  const last=link.history?.[0];
  $('#modalTitle').textContent='Popraw wyniki';
  const form=$('#itemForm');form.dataset.mode='refine';form.dataset.id=id;
  form.innerHTML='<p class="refine-name">'+esc(link.title)+'</p>'
    +'<div class="field"><label for="field-refine">Co jest nie tak z wynikami?</label><textarea id="field-refine" name="note" maxlength="300" required placeholder="Np. za dużo stanowisk seniorskich, za dużo firm konsultingowych">'+esc(note)+'</textarea></div>'
    +'<div id="refineResult" aria-live="polite"></div>'
    +(last?'<p class="hint">Ostatnia zmiana: '+esc(last.change||last.note)+' <button type="button" class="btn tiny ghost" data-action="refine-undo" data-id="'+esc(id)+'">Cofnij</button></p>':'')
    +'<div class="form-actions" id="refineActions"><button class="btn secondary" type="button" data-action="modal-close">Anuluj</button><button class="btn" type="submit">'+I('tune')+' Popraw</button></div>';
  window.ratchetHydrateIcons?.($('#modal'));
  $('#modal').hidden=false;$('#field-refine').focus();
}
async function submitRefine(form){
  const id=form.dataset.id,note=String(new FormData(form).get('note')||'').trim();
  if(!note)throw Error('Napisz, co jest nie tak z wynikami.');
  const btn=form.querySelector('button[type="submit"]');btn.disabled=true;btn.textContent='Claude poprawia…';
  $('#refineResult').innerHTML='<p class="hint">Zwykle trwa to kilka sekund.</p>';
  try{refineProposal={...await bridge.refineLink(id,note),note};}
  catch(e){$('#refineResult').innerHTML='';btn.disabled=false;btn.innerHTML=I('tune')+' Popraw';throw e;}
  const p=refineProposal;
  $('#refineResult').innerHTML='<div class="refine-proposal"><strong>'+esc(p.same?'Link już spełnia tę uwagę':p.change)+'</strong><span class="refine-url">'+esc(p.url)+'</span></div>';
  $('#refineActions').innerHTML='<button class="btn ghost" type="button" data-action="refine-preview">'+I('external')+' Podgląd</button><span class="spacer"></span>'
    +'<button class="btn secondary" type="button" data-action="refine-again" data-id="'+esc(id)+'">Jeszcze raz</button>'
    +(p.same?'':'<button class="btn" type="button" data-action="refine-save" data-id="'+esc(id)+'">'+I('check')+' Zapisz</button>');
  window.ratchetHydrateIcons?.($('#modal'));
}
// Three words a person understands: works, done, needs you.
const labels={working:['Pracuje','blue'],needs_attention:['Potrzebuje Cię','amber'],ready:['Gotowe — zobacz','green'],blocked:['Potrzebuje Cię','red'],idle:['Spoczynek','idle']};
// A Claude Code session leads to the Claude window; a manual entry to its link.
function agentOpen(a){
  return a.source==='hook'?' data-action="agent-focus" data-id="'+esc(a.id)+'" title="Przejdź do Claude"'
    :a.target?' data-action="open" data-kind="'+esc(a.kind||'url')+'" data-target="'+esc(a.target)+'" title="Otwórz"'
    :' data-action="edit" data-collection="agents" data-id="'+esc(a.id)+'" title="Edytuj"';
}
// Every automatic row reads the same way. Grey above: where it runs (tool · folder or
// ChatGPT project). White: what it is about (session or chat title), never the folder.
function agentNames(a){
  const tool=a.source==='hook'?'Claude':a.source==='browser'?'ChatGPT':'';
  const topic=tool?(a.topic||'Bez tematu'):'';
  const place=[tool,tool&&String(a.title).toLowerCase()!==tool.toLowerCase()?a.title:''].filter(Boolean).join(' · ');
  return {tool,topic,place};
}
function waitingRow(a){
  const {tool,topic,place}=agentNames(a);
  const since=a.updatedAt?Date.now()-Date.parse(a.updatedAt):0;
  const wait=since>=60000?' · '+duration(since):'';
  const color=a.status==='ready'?'green':a.status==='blocked'?'red':'amber';
  return '<article class="row agent-row"><span class="s-dot '+color+'" aria-hidden="true"></span>'
    +'<button class="row-main"'+agentOpen(a)+'>'+(place?'<span class="row-meta">'+esc(place)+'</span>':'')
    +'<span class="row-title">'+esc(topic||a.title)+'</span><span class="row-meta">'+esc(WAITING[a.status]+wait)+'</span></button>'
    +(tool?'<button class="row-act quiet-act" data-action="agent-finish" data-id="'+esc(a.id)+'" title="Odhacz" aria-label="Odhacz: '+esc(topic)+'">'+I('check')+'</button>':'')
    +'</article>';
}
function renderAgent(a){
  const [label,color]=labels[a.status]||labels.idle;
  const open=agentOpen(a),{tool,topic,place}=agentNames(a);
  // Guard (pilot): a shield on Claude rows whose project has a proof. On = the agent
  // may not finish until the proof passes (see guardVerdict in core.cjs).
  const guardOptions=snapshot.guardOptions?.[a.id]||[],guardOption=guardOptions[0];
  const guardOn=Object.values(state().guards||{}).find(g=>g.row===a.id);
  // "Zweryfikowane" only when the latest proof for this project passed and the agent is done.
  const lastProof=(state().verifications||[]).find(v=>v.row===a.id);
  const guardNote=guardOn?' · Strażnik '+guardOn.rounds+'/'+((guardOptions.find(g=>g.id===guardOn.guard)||guardOption)?.maxRounds||3)
    :lastProof?.verdict==='pass'&&a.status==='ready'?' · Zweryfikowane':'';
  return '<article class="row agent-row"><span class="s-dot '+color+'" aria-hidden="true"></span>'
    +'<button class="row-main"'+open+'>'+(place?'<span class="row-meta">'+esc(place)+'</span>':'')
    +'<span class="row-title">'+esc(topic||a.title)+'</span><span class="row-meta">'+esc(label)+esc(guardNote)+(a.updatedAt?' · '+formatTime(a.updatedAt):'')+'</span></button>'
    +(guardOption?'<button class="row-act'+(guardOn?'':' quiet-act')+'" data-action="guard-toggle" data-id="'+esc(a.id)+'" data-guard="'+esc(guardOption.id)+'" data-on="'+(guardOn?'1':'')+'" aria-pressed="'+(guardOn?'true':'false')+'" title="'+(guardOn?'Wyłącz strażnika':'Strażnik: '+esc(guardOption.label))+'" aria-label="'+(guardOn?'Wyłącz strażnika':'Włącz strażnika: '+esc(guardOption.label))+'">'+I('shield')+'</button>':'')
    // Rows Rachet keeps itself end with one click (no question asked); they come back
    // when that work starts again. Rows added by hand keep the edit button.
    +(tool
      ?'<button class="row-act quiet-act" data-action="agent-finish" data-id="'+esc(a.id)+'" title="Zakończ" aria-label="Zakończ: '+esc(topic)+'">'+I('check')+'</button>'
      :'<button class="row-act quiet-act" data-action="edit" data-collection="agents" data-id="'+esc(a.id)+'" title="Edytuj" aria-label="Edytuj: '+esc(a.title)+'">'+I('edit')+'</button>')
    +'</article>';
}
function renderAgents(){
  const a=state().agents;
  const order={needs_attention:0,blocked:0,ready:1,working:2,idle:3};
  const sorted=[...a].sort((x,y)=>(order[x.status]??4)-(order[y.status]??4));
  let html='';
  html+='<div class="list-head"><h3>Agenci</h3><button class="btn tiny secondary" data-action="new" data-collection="agents">+ Dodaj</button></div>';
  html+=sorted.length?'<div class="rows">'+sorted.map(renderAgent).join('')+'</div>'
    :'<p class="list-empty">Nikt teraz nie pracuje. Gdy agent skończy albo będzie Cię potrzebować, dam znać.</p>';
  return html;
}
function renderUpdates(){
  const available=!!updateInfo?.available;
  return `<div class="settings-group update-group"><h3>Wersja <strong>0.2.9</strong></h3>
  ${available?`<p class="update-ready">Dostępna wersja ${esc(updateInfo.version)}: ${esc(updateInfo.notes)}</p><button class="btn full" type="button" data-action="update-install">${I('download')} Zainstaluj ${esc(updateInfo.version)}</button>`:
  `<button class="btn secondary small" type="button" data-action="update-check">${I('refresh')} Sprawdź aktualizacje</button>`}
  <p class="hint">Aktualizacje przez GitHub CLI (gh auth login), pliki sprawdzane SHA-256.</p></div>`;
}
function renderSettings(){
  const s=state().settings,size=Number(s.avatarSize||84);
  const sizes=[[48,'48 px'],[56,'56 px'],[64,'64 px'],[72,'72 px'],[84,'84 px'],[100,'100 px'],[112,'112 px']];
  return '<div class="list-head"><h3>Ustawienia</h3><button class="btn tiny ghost" data-action="switch" data-tab="today">Gotowe</button></div>'
    +'<form id="settingsForm"><div class="settings-group">'
    +'<div class="field"><label for="avatarSize">Rozmiar kuleczki</label><select id="avatarSize" name="avatarSize">'+sizes.map(([v,l])=>'<option value="'+v+'"'+(size===v?' selected':'')+'>'+l+'</option>').join('')+'</select></div>'
    +'<label class="checkbox-row"><input type="checkbox" name="notifications" '+(s.notifications?'checked':'')+'> Powiadomienia</label>'
    +'<label class="checkbox-row"><input type="checkbox" name="alwaysOnTop" '+(s.alwaysOnTop?'checked':'')+'> Kuleczka zawsze na wierzchu</label>'
    +'<label class="checkbox-row"><input type="checkbox" name="autoStart" '+(s.autoStart?'checked':'')+'> Uruchamiaj z Windows</label>'
    +'<div class="form-actions"><button type="button" class="btn ghost small" data-action="notification-test">'+I('bell')+' Test</button><button class="btn small" type="submit">Zapisz</button></div></div>'
    +more('settings-more','Więcej',
      '<div class="field"><label for="repo">Repozytorium GitHub</label><input id="repo" name="repo" value="'+esc(s.repo)+'" placeholder="Zyczinho/city-route-app" required></div>'
      +'<div class="inline-actions"><button type="button" class="btn secondary small" data-action="reset-orb">Kuleczka na ekran główny</button><button type="button" class="btn secondary small" data-action="reset-panel-size">Mały panel 360 × 520</button></div>')
    +'</form>'+renderUpdates()
    +'<p class="hint">Dane zostają na tym komputerze. Rachet nie wysyła promptów sam i nie scala kodu.</p>'
    +(DEMO?'<div class="alert">Podgląd w przeglądarce. Kuleczka, powiadomienia i foldery działają w aplikacji Windows.</div>':'');
}
function compactConfirm(message){
  return new Promise(resolve=>{
    const modal=$('#confirmModal'),text=$('#confirmText'),yes=$('#confirmAccept'),no=$('#confirmCancel');
    const previous=document.activeElement;
    text.textContent=message;modal.hidden=false;
    const finish=value=>{
      modal.hidden=true;yes.removeEventListener('click',accept);no.removeEventListener('click',cancel);
      modal.removeEventListener('keydown',keys);previous?.focus?.();resolve(value);
    };
    const accept=()=>finish(true),cancel=()=>finish(false);
    const keys=e=>{
      if(e.key==='Escape'){e.preventDefault();cancel();}
      if(e.key==='Tab'){e.preventDefault();(document.activeElement===yes?no:yes).focus();}
    };
    yes.addEventListener('click',accept);no.addEventListener('click',cancel);
    modal.addEventListener('keydown',keys);no.focus();
  });
}
function render(){renderBadge();document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));$('#view').innerHTML=tab==='today'?renderToday():tab==='agents'?renderAgents():renderSettings();window.ratchetHydrateIcons?.(document);}
const templateMap={job:{title:'Szukanie pracy',time:'09:00',project:'Kariera',target:'https://chatgpt.com/'},city:{title:'Praca nad City Route',time:'10:00',project:'City Route',target:'https://github.com/Zyczinho/city-route-app'},box:{title:'Promocje Box2Box',time:'14:00',project:'Box2Box',target:'https://box2box.com.pl'}};
const input=(name,label,value='',opts='')=>`<div class="field"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" value="${esc(value)}" ${opts}></div>`;
const select=(name,label,value,options)=>`<div class="field"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></div>`;
function showModal(collection,id='',prefill={}){
  const item=state()[collection].find(x=>x.id===id)||prefill||{};
  $('#modalTitle').textContent=(id?'Edytuj':'Dodaj')+' '+({schedule:'blok dnia',links:'skrót',agents:'agenta'}[collection]);
  const days=item.days||[now().getDay()];
  let fields='';
  if(collection==='schedule'){
    fields+=input('title','Co robimy?',item.title,'placeholder="Np. spotkanie z zespołem" required maxlength="160"');
    fields+=`<div class="form-grid">${input('time','Początek',item.time||'09:00','type="time" required')}${input('endTime','Koniec',item.endTime||plusMinutes(item.time||'09:00'),'type="time" required')}</div>`;
    fields+=`<div id="onceFields">${input('date','Dzień',item.date||dateKey(),'type="date" required')}</div>`;
    fields+=input('target','Otwórz jednym kliknięciem — strona, czat lub folder',item.target,'placeholder="https://... lub C:\\Users\\... (opcjonalnie)"');
    fields+=`<div class="field"><label for="field-note">Notatka</label><textarea id="field-note" name="note" placeholder="Co dokładnie masz zrobić? (opcjonalnie)">${esc(item.note||'')}</textarea></div>`;
    let extra=select('repeat','Powtarzanie',item.date===null?'weekly':'once',[['once','Jednorazowo'],['weekly','Co tydzień']]);
    extra+=`<div class="field" id="weeklyFields"><label>Dni tygodnia (cyklicznie)</label><div class="weekday-row">${[1,2,3,4,5,6,0].map(d=>`<label class="daycheck"><input type="checkbox" name="days" value="${d}" ${days.includes(d)?'checked':''}><span>${weekdays[d]}</span></label>`).join('')}</div></div>`;
    extra+=input('project','Projekt',item.project,'placeholder="Np. City Route"');
    extra+=`<label class="checkbox-row"><input type="checkbox" name="enabled" ${item.enabled!==false?'checked':''}> Przypominaj o początku i końcu</label>`;
    fields+=more('task-more','Więcej opcji',extra);
  } else if(collection==='links'){
    fields+=input('title','Nazwa skrótu',item.title,'placeholder="Np. Sesja o City Route" required');
    fields+=select('kind','Typ celu',item.kind||'url',[['url','Strona / czat'],['folder','Folder / plik Windows']]);
    fields+=input('target','Adres / ścieżka',item.target,'placeholder="https://... lub C:\\Users\\..." required');
    fields+=input('group','Kategoria',item.group||'Projekt','placeholder="Np. Projekt"');
  } else {
    fields+=input('title','Nazwa zadania',item.title,'placeholder="Np. Claude — poprawki UX" required');
    fields+=select('tool','Model / narzędzie',item.tool||'ChatGPT',[['ChatGPT','ChatGPT'],['Claude','Claude (web)'],['Claude Code','Claude Code'],['Codex','Codex'],['Cursor','Cursor'],['Inny model','Inny model']]);
    fields+=select('status','Status',item.status||'working',[['working','Pracuje'],['needs_attention','Czeka na mnie'],['ready','Zgłoszone jako gotowe (niezweryfikowane)'],['blocked','Zablokowane'],['idle','Spoczynek']]);
    fields+=select('kind','Typ celu',item.kind||'url',[['url','Link do konwersacji'],['folder','Folder projektu Windows']]);
    fields+=input('target','Otwórz sesję',item.target,'placeholder="Wklej adres rozmowy lub folder"');
    fields+=input('branch','Gałąź Git (opcjonalnie)',item.branch,'placeholder="feature/xyz"');
    fields+=`<div class="field"><label for="field-note">Co dokładnie robi agent?</label><textarea id="field-note" name="note" placeholder="Ostatnie polecenie, na co czeka, co przetestować">${esc(item.note||'')}</textarea></div>`;
  }
  $('#itemForm').dataset.collection=collection;$('#itemForm').dataset.id=id;delete $('#itemForm').dataset.mode;
  const removeBtn=id?`<button class="btn ghost danger-text" type="button" data-action="remove" data-collection="${esc(collection)}" data-id="${esc(id)}">Usuń</button><span class="spacer"></span>`:'';
  $('#itemForm').innerHTML=fields+`<div class="form-actions">${removeBtn}<button class="btn secondary" type="button" data-action="modal-close">Anuluj</button><button class="btn" type="submit">${id?'Zapisz':'Dodaj'}</button></div>`;
  window.ratchetHydrateIcons?.($('#modal'));
  $('#modal').hidden=false;
  $('#itemForm input[name="title"]')?.focus();
  toggleRepeatFields();
}
function toggleRepeatFields(){const select=$('#itemForm select[name="repeat"]');if(!select)return;const weekly=select.value==='weekly';const once=$('#onceFields'),week=$('#weeklyFields');if(once)once.style.display=weekly?'none':'block';if(week)week.style.display=weekly?'block':'none';const date=$('#itemForm input[name="date"]');if(date)date.required=!weekly;}
async function saveForm(form){
  const col=form.dataset.collection,id=form.dataset.id;
  const data=new FormData(form);const item={id:id||undefined};
  for(const [key,val] of data.entries())if(key!=='days')item[key]=val;
  if(col==='schedule'&&id){
    const previous=state().schedule.find(x=>x.id===id);
    if(previous?.completedDates)item.completedDates=previous.completedDates;
  }
  if(col==='schedule'){
    item.days=data.getAll('days').map(Number);
    if(data.get('repeat')==='once')item.date=data.get('date');else item.date=null;
    if(!item.date&&!item.days.length)throw Error('Wybierz co najmniej jeden dzień');
    item.enabled=data.get('enabled')==='on';
    item.kind=/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(String(item.target||'').trim())?'folder':'url';
    if(!item.endTime||item.endTime<=item.time)throw Error('Koniec bloku musi być później niż początek');
  }
  if(col==='agents'){
    item.source='manual';item.updatedAt=new Date().toISOString();
  }
  await bridge.save(col,item);
  if(!DEMO)snapshot=await bridge.snapshot();
  $('#modal').hidden=true;
  render();toast('Zapisane ✓');
}
async function handleAction(el){
  const act=el.dataset.action,id=el.dataset.id,col=el.dataset.collection;
  if(act==='new')showModal(col);
  if(act==='calendar-add'){
    // One add form for Today; it starts at the next full hour.
    const day=/^\d{4}-\d{2}-\d{2}$/.test(el.dataset.date||'')?el.dataset.date:dateKey();
    const start=day===dateKey()?pad(Math.min(23,now().getHours()+1))+':00':'09:00';
    showModal('schedule','',{date:day,time:start});
  }
  if(act==='template')showModal('schedule','',templateMap[el.dataset.template]);
  if(act==='switch'){tab=el.dataset.tab;render();}
  if(act==='activity-remove'){
    await bridge.removeActivity(id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Sygnał usunięty');
  }
  if(act==='activity-clear'){
    if(!await compactConfirm('Wyczyścić historię sygnałów? Zadania i przypomnienia pozostaną bez zmian.'))return;
    await bridge.clearActivity();if(!DEMO)snapshot=await bridge.snapshot();render();toast('Sygnały wyczyszczone');
  }
  if(act==='edit')showModal(col,id);
  if(act==='modal-close')$('#modal').hidden=true;
  if(act==='remove') {
    const item=state()[col].find(x=>x.id===id);
    if(!await compactConfirm(`Usunąć: ${item?.title||'element'}?`))return;
    $('#modal').hidden=true;
    await bridge.remove(col,id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Usunięto');
  }
  if(act==='schedule-start'||act==='schedule-snooze'||act==='schedule-finish'){
    await bridge.scheduleAction(id,act==='schedule-start'?'start':act==='schedule-finish'?'finish':'snooze');
    if(!DEMO)snapshot=await bridge.snapshot();render();toast(act==='schedule-start'?'Działamy! ✦':act==='schedule-finish'?'Zakończono ✓':'Przypomnę za 10 minut');
  }
  if(act==='open'){await bridge.open(el.dataset.kind,el.dataset.target);toast('Otwieram ↗');}
  if(act==='refine')showRefine(id);
  if(act==='refine-again')showRefine(id,refineProposal?.note||'');
  if(act==='refine-preview'&&refineProposal){await bridge.open('url',refineProposal.url);toast('Otwieram podgląd ↗');}
  if(act==='refine-save'&&refineProposal){
    await bridge.applyLink(id,refineProposal);refineProposal=null;
    if(!DEMO)snapshot=await bridge.snapshot();$('#modal').hidden=true;render();toast('Link poprawiony ✓');
  }
  if(act==='refine-undo'){
    await bridge.undoLink(id);if(!DEMO)snapshot=await bridge.snapshot();$('#modal').hidden=true;render();toast('Przywrócono poprzedni link');
  }
  if(act==='agent-focus'){await bridge.focusAgent(id);toast('Przechodzę do Claude ↗');}
  if(act==='hint-snooze'){snoozeHint(id);render();return;}
  if(act==='agent-finish'){await bridge.finishAgent(id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Zakończone. Wróci, gdy znów zaczniesz ✓');}
  if(act==='guard-toggle'){
    if(el.dataset.on){await bridge.guardStop(id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Strażnik wyłączony');return;}
    // A project can have several proofs: they are offered one by one, the first "yes" wins.
    let option=null;
    for(const g of snapshot.guardOptions?.[id]||[]){
      if(await compactConfirm('Włączyć strażnika „'+g.label+'” dla sesji, w której teraz pracujesz? Gdy agent powie „gotowe”, Rachet to sprawdzi. Jeśli warunek nie jest spełniony, odeśle agenta do pracy (najwyżej '+g.maxRounds+' razy), potem da Ci znać. '+(g.note||'')))
      {option=g;break;}
    }
    if(!option)return;
    await bridge.guardStart(id,option.id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Strażnik pilnuje tej sesji 🛡');
  }
  if(act==='diagnose'){await bridge.diagnose();$('#appMenu').hidden=true;toast('Zlecono lokalną diagnostykę. Raport otworzy się na komputerze.');}
  if(act==='update-check'){
    tab='settings';render();toast('Sprawdzam kanał aktualizacji…');
    updateInfo=await bridge.checkUpdate();
    render();toast(updateInfo.available?'Dostępna aktualizacja '+updateInfo.version:'Masz aktualną wersję ✓');
  }
  if(act==='update-install'){
    if(!await compactConfirm('Zainstalować Rachet '+updateInfo.version+'? Aplikacja uruchomi się ponownie, a Twoje zadania pozostaną zapisane.'))return;
    toast('Pobieram i weryfikuję aktualizację…');
    await bridge.installUpdate();
    toast('Rachet uruchomi się ponownie.');
  }
  if(act==='reset-orb'){await bridge.resetOrb();toast('Kuleczka wróciła na ekran główny');}
  if(act==='reset-panel-size'){await bridge.saveSettings({panelSize:null});toast('Następnym razem panel otworzy się w rozmiarze 360 × 520');}
  if(act==='notification-test'){
    const result=await bridge.testNotification();
    if(!result?.queued){toast(DEMO?'Test działa tylko w aplikacji Windows':'Włącz powiadomienia i zapisz ustawienia');return;}
    toast('Test w kolejce. Sprawdź dymek przy kuleczce…');
    setTimeout(()=>safe(async()=>{
      const status=await bridge.notificationStatus(result.id);
      toast(status.delivery?.bubbleShown?'Kuleczka potwierdziła wyświetlenie dymku ✓':'Brak potwierdzenia dymku — uruchom diagnostykę');
    }),3200);
  }
  if(act==='show-settings'){tab='settings';render();$('#appMenu').hidden=true;$('#appMenuToggle').setAttribute('aria-expanded','false');}
  if(act==='hide-panel'){$('#appMenu').hidden=true;await bridge.hidePanel();}
  if(act==='quit'){
    if(!await compactConfirm('Zakończyć Rachet? Kuleczka i przypomnienia przestaną działać do ponownego uruchomienia.'))return;
    await bridge.quit();
    $('#appMenu').hidden=true;
    if(!DEMO){
      $('#view').innerHTML='<div class="empty"><div class="empty-emoji">✓</div><strong>Rachet zakończył pracę</strong><p>Zadania i skróty są bezpiecznie zapisane. Możesz zamknąć to okno.</p></div>';
      setTimeout(()=>{try{window.close();}catch{}},350);
    }
  }
}
document.addEventListener('change',e=>{if(e.target.name==='repeat')toggleRepeatFields();});
document.addEventListener('click',e=>{
  if(e.target.closest('#appMenuToggle')){
    const menu=$('#appMenu');menu.hidden=!menu.hidden;
    $('#appMenuToggle').setAttribute('aria-expanded',String(!menu.hidden));return;
  }
  if(!e.target.closest('.panel-menu-wrap')){
    $('#appMenu').hidden=true;
    $('#appMenuToggle').setAttribute('aria-expanded','false');
  }
  const tabButton=e.target.closest('[data-tab].tab');
  if(tabButton){tab=tabButton.dataset.tab;render();return;}
  const a=e.target.closest('[data-action]');if(a)safe(()=>handleAction(a));
});
document.addEventListener('submit',e=>{
  if(e.target.id==='itemForm'){e.preventDefault();safe(()=>e.target.dataset.mode==='refine'?submitRefine(e.target):saveForm(e.target));}
  if(e.target.id==='settingsForm'){
    e.preventDefault();safe(async()=>{
      const data=new FormData(e.target),s={repo:String(data.get('repo')||'').trim(),notifications:data.get('notifications')==='on',alwaysOnTop:data.get('alwaysOnTop')==='on',autoStart:data.get('autoStart')==='on',avatarSize:Number(data.get('avatarSize')||84)};
      if(!/^[\w.-]+\/[\w.-]+$/.test(s.repo))throw Error('Podaj repozytorium jako właściciel/nazwa');
      await bridge.saveSettings(s);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Ustawienia zapisane');
    });
  }
});
$('#closePanel').addEventListener('click',()=>safe(()=>bridge.hidePanel()));
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#modal').hidden=true;});
bridge.onSnapshot(next=>{snapshot=next;render();});
safe(async()=>{snapshot=await bridge.snapshot();if(DEMO)persistDemo();render();if(!DEMO){try{updateInfo=await bridge.checkUpdate();if(updateInfo.available){document.body.classList.add('update-available');toast('Nowy Rachet '+updateInfo.version+' — otwórz Ustawienia');}}catch(e){console.info('Rachet update check:',e.message);}}});
setInterval(()=>{if(tab==='today')render();},30000);
