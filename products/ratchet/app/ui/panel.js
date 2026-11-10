'use strict';
const DEMO = !window.ratchet;
if(!DEMO) window.addEventListener('ratchet:connection', e=>{
  const tag=document.getElementById('backendStatus');
  if(!tag) return;
  const up=!!e.detail?.online;
  tag.classList.toggle('offline',!up);
  tag.innerHTML='<span class="live-dot"></span> '+(up?'LOKALNIE':'BRAK POŁĄCZENIA');
});
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
let snapshot=DEMO?loadDemo():demoInitial,tab='today',agentFilter=null,toastTimer,updateInfo=null;
// One-time introduction is UI-only. No API call, model launch, or change to coordinator.enabled.
const AGENT_GUIDE_KEY='ratchet-agents-intro-v1';
const agentGuideWasSeen=()=>{try{return localStorage.getItem(AGENT_GUIDE_KEY)==='seen';}catch{return false;}};
let agentGuideSeen=agentGuideWasSeen(),agentGuideOpen=false,agentGuideStep=0;
function finishAgentGuide(){
  agentGuideSeen=true;agentGuideOpen=false;agentGuideStep=0;
  try{localStorage.setItem(AGENT_GUIDE_KEY,'seen');}catch{/* Keep the choice in this session when storage is unavailable. */}
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
let selectedDay=dateKey(),calendarMonth=new Date(now().getFullYear(),now().getMonth(),1);
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
  open:async(kind,target)=>{if(kind==='folder')throw Error('Otwieranie folderów działa w aplikacji Windows');if(!/^https?:\/\//.test(target))throw Error('Niepoprawny link');window.open(target,'_blank','noopener,noreferrer');},
  chatgptSignalRemove:async id=>{state().chatgptSignals=(state().chatgptSignals||[]).filter(x=>x.id!==id);persistDemo();return true;},
  chatgptCreate:async()=>{throw Error('Funkcja wymaga tokenu Workspace Agents w aplikacji Windows.');},
  chatgptRefresh:async()=>({ok:true}),
  chatgptResume:async()=>{throw Error('Wymagany token Workspace Agents.');},
  chatgptRemove:async id=>{state().chatgptRuns=(state().chatgptRuns||[]).filter(j=>j.id!==id);persistDemo();return true;},
  coordinatorCreate:async data=>{throw Error('Uruchamianie agentów działa w aplikacji Windows.');},
  coordinatorEnable:async enabled=>{state().coordinator.enabled=enabled;persistDemo();return {enabled};},
  coordinatorRetry:async()=>{throw Error('Uruchamianie agentów działa w aplikacji Windows.');},
  coordinatorRemove:async id=>{state().coordinator.jobs=state().coordinator.jobs.filter(j=>j.id!==id);persistDemo();},
  handoff:async()=>{const text=`Ratchet (podgląd) — agenci:\n${state().agents.map(a=>`${a.title}: ${a.status} ${a.note}`).join('\n')}`;await navigator.clipboard.writeText(text);return text;},
  refreshGithub:async()=>({github:null,githubError:'GitHub jest obsługiwany w aplikacji Windows.'}),
  checkUpdate:async()=>({available:false,version:'0.2.9',current:'0.2.9'}),
  installUpdate:async()=>toast('Aktualizator działa w aplikacji Windows'),
  testNotification:async()=>({queued:false,notificationsEnabled:false}),
  notificationStatus:async()=>({found:false,delivery:null}),
  diagnose:async()=>{throw Error('Diagnostyka działa w aplikacji Windows');},
  hidePanel:async()=>toast('Podgląd: ukrywanie działa w aplikacji Windows'),
  quit:async()=>toast('Podgląd: wyłączanie działa w aplikacji Windows'),
  resetOrb:async()=>toast('Pozycja kuleczki działa w aplikacji Windows')
};
function updateClock(){const d=now();$('#clock').textContent=`${pad(d.getHours())}:${pad(d.getMinutes())}`;$('#dateLabel').textContent=formatDate(d);}
function health(){
  const agents=state().agents;
  const jobs=state().coordinator?.jobs||[],chatRuns=state().chatgptRuns||[],signals=state().chatgptSignals||[];
  const running=agents.filter(x=>x.status==='working').length+jobs.filter(x=>x.status==='running').length+chatRuns.filter(x=>['queued','in_progress','suspended','submitting'].includes(x.status)).length+signals.filter(x=>x.status==='working').length;
  const attention=agents.filter(x=>x.status==='needs_attention'||x.status==='blocked').length+jobs.filter(x=>x.status==='attention').length+chatRuns.filter(x=>x.status==='failed'||x.status==='attention').length+signals.filter(x=>x.status==='needs_attention').length;
  const failed=(snapshot.github?.runs||[]).some(x=>x.status==='completed'&&['failure','timed_out'].includes(x.conclusion));
  const overlaps=(snapshot.github?.overlapping||[]).length;
  return {running,attention,failed,overlaps};
}
function renderStrip(){
  const h=health();
  const box=(metric,dot,content,label)=>'<button type="button" class="status-box" data-action="metric" data-metric="'+metric+'" aria-label="'+label+'"><span class="s-dot '+dot+'"></span>'+content+'</button>';
  $('#statusStrip').innerHTML=box('working','blue','<strong>'+h.running+'</strong> pracuje','Pokaż pracujących agentów')
    +box('attention',h.attention?'amber':'green','<strong>'+h.attention+'</strong> uwagi','Pokaż sprawy wymagające uwagi')
    +box('risk',h.failed?'red':h.overlaps?'amber':'violet','<strong>'+(h.failed?'Błąd CI':h.overlaps?h.overlaps+' ryzyk':'GitHub')+'</strong>','Pokaż ryzyka GitHub i CI');
}
function sectionHeader(title,subtitle,button=''){return `<div class="section-header"><div><h1>${title}</h1>${subtitle?`<p class="sub">${subtitle}</p>`:''}</div>${button}</div>`;}
function empty(title,desc,emoji='✦'){return `<div class="empty"><div class="empty-emoji">${emoji}</div><strong>${title}</strong><p>${desc}</p></div>`;}
function taskActions(t){
  if(Array.isArray(t.completedDates)&&t.completedDates.includes(dateKey()))
    return '<div class="task-actions"><span class="pill good">✓ Ukończone dziś</span><button class="plain-icon" data-action="edit" data-collection="schedule" data-id="'+esc(t.id)+'" title="Edytuj" aria-label="Edytuj">'+I('edit')+'</button><button class="plain-icon" data-action="remove" data-collection="schedule" data-id="'+esc(t.id)+'" title="Usuń" aria-label="Usuń">'+I('trash')+'</button></div>';
  return `<div class="task-actions"><button class="btn small" data-action="schedule-start" data-id="${esc(t.id)}">${I('play')} Działam${t.target?' · otwórz':''}</button><button class="btn secondary small" data-action="schedule-finish" data-id="${esc(t.id)}">${I('check')} Zakończ</button><button class="btn ghost small" data-action="schedule-snooze" data-id="${esc(t.id)}">+10 min</button><button class="plain-icon" aria-label="Edytuj" title="Edytuj" data-action="edit" data-collection="schedule" data-id="${esc(t.id)}">${I('edit')}</button><button class="plain-icon" aria-label="Usuń" title="Usuń" data-action="remove" data-collection="schedule" data-id="${esc(t.id)}">${I('trash')}</button></div>`;}
function renderToday(){
  const tasks=todayTasks();const pending=tasks.filter(t=>t.enabled&&!t.completedDates?.includes(dateKey()));const upcoming=pending.find(t=>+t.time.slice(0,2)*60+Number(t.time.slice(3))>=now().getHours()*60+now().getMinutes())||pending.at(-1);
  const h=health();
  const hero=upcoming?`<section class="hero"><div class="eyebrow">${upcoming.time===`${pad(now().getHours())}:${pad(now().getMinutes())}`?'TERAZ TWOJA KOLEJ':'NASTĘPNY BLOK'}</div><h2>${esc(upcoming.title)} <span style="color:#9bc7ff">· ${esc(upcoming.time)}</span></h2><p>${esc(upcoming.note||`Ratchet przypomni Ci i pomoże od razu przejść do właściwego miejsca.`)}</p><div class="hero-actions"><button class="btn" data-action="schedule-start" data-id="${esc(upcoming.id)}">${I('play')} Działam${upcoming.target?' · otwórz':''}</button><button class="btn secondary" data-action="schedule-snooze" data-id="${esc(upcoming.id)}">Później</button></div></section>`:
  `<section class="hero"><div class="eyebrow">DZIŚ MASZ KONTROLĘ</div><h2>Mniej przełączania.<br>Więcej działania.</h2><p>Dodaj bloki dnia, przypisz im link lub folder. Ratchet przypomni Ci, gdzie masz być.</p><div class="hero-actions"><button class="btn" data-action="new" data-collection="schedule">+ Zaplanuj pierwszy blok</button></div></section>`;
  let html=hero+`<form class="quick-form" id="quickPlanForm"><input name="phrase" aria-label="Dodaj zadanie jednym zdaniem" placeholder="Np. o 12:00 spotkanie z zespołem" required><button class="btn" type="submit">+ Zapisz</button></form><p class="quick-hint">Wpisz godzinę i opcjonalnie „jutro”. Ratchet zapisze blok w kalendarzu.</p>`+sectionHeader('Twój plan dnia',`${tasks.length} bloków na dziś`,`<button class="btn small secondary" data-action="new" data-collection="schedule">+ Dodaj</button>`);
  html += tasks.length?`<div class="timeline">${tasks.map(t=>`<article class="task-card" style="opacity:${t.enabled?1:.48}"><div class="time">${esc(t.time)}${t.endTime?`<div class="task-note">do ${esc(t.endTime)}</div>`:''}</div><div class="task-body"><div class="task-title">${esc(t.title)} ${t.project?`<span class="pill">${esc(t.project)}</span>`:''}</div><div class="task-note">${esc(t.note|| (t.target?short(t.target):'Brak przypiętego linku'))}</div>${taskActions(t)}</div></article>`).join('')}</div>`:
  `<div class="empty"><div class="empty-emoji">${I('calendar')}</div><strong>Żadnych bloków na dziś</strong><p>Wybierz przykład — otworzysz formularz z gotowymi danymi.</p><div class="templates"><button class="template" data-action="template" data-template="job">09:00 Praca</button><button class="template" data-action="template" data-template="city">10:00 City Route</button><button class="template" data-action="template" data-template="box">14:00 Box2Box</button></div></div>`;

  const recent=state().activity.slice(0,3);
  html+=`<div class="group-title"><h3>Ostatnie sygnały</h3>${state().activity.length?'<button class="btn tiny ghost" data-action="activity-clear">Wyczyść</button>':''}</div>`;
  html+=recent.length?recent.map(a=>`<article class="task-card"><span class="s-dot ${a.level==='reminder'?'amber':'green'}" style="margin-top:5px"></span><div class="task-body"><div class="task-title">${esc(a.text)}</div><div class="task-note">${formatTime(a.at)}</div>${a.taskId?`<div class="inline-actions"><button class="btn small" data-action="schedule-start" data-id="${esc(a.taskId)}">Działam</button><button class="btn small ghost" data-action="schedule-snooze" data-id="${esc(a.taskId)}">+10 min</button></div>`:''}</div><button class="plain-icon" data-action="activity-remove" data-id="${esc(a.id)}" title="Usuń sygnał" aria-label="Usuń sygnał">${I('trash')}</button></article>`).join(''):'<p class="hint">Brak ostatnich sygnałów.</p>';
  html+=`<div class="group-title"><h3>Jeden klik do projektu</h3><button class="plain-icon" data-action="switch" data-tab="links" aria-label="Wszystkie skróty" title="Wszystkie skróty">${I('link')}</button></div>${renderQuickLinks(4)}`;
  if(h.attention||h.failed||h.overlaps)html+=`<div class="alert">${I('alert')} ${h.attention?'Masz agenta wymagającego uwagi. ':''}${h.failed?'Test CI na GitHubie zakończył się błędem. ':''}${h.overlaps?'PR-y mogą edytować te same pliki. ':''}<button class="btn tiny ghost" data-action="switch" data-tab="agents">Sprawdź agentów</button></div>`;
  return html;
}

function tasksOnCalendarDay(key){
  // Work in local calendar days so recurring schedules don't shift due to UTC offsets.
  const [year,month,day]=key.split('-').map(Number);
  const weekday=new Date(year,month-1,day).getDay();
  return state().schedule.filter(t=>t.date?t.date===key:(Array.isArray(t.days)&&t.days.includes(weekday)))
    .sort((a,b)=>a.time.localeCompare(b.time));
}
function calendarDayName(key){
  const [y,m,d]=key.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
function renderCalendar(){
  const today=dateKey(),monthName=calendarMonth.toLocaleDateString('pl-PL',{month:'long',year:'numeric'});
  const first=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1);
  const count=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  const leading=(first.getDay()+6)%7;
  const names=['Pn','Wt','Śr','Cz','Pt','So','Nd'];
  let grid='<div class="calendar-weekdays">'+names.map(x=>'<span>'+x+'</span>').join('')+'</div><div class="calendar-grid">';
  for(let i=0;i<leading;i++)grid+='<span class="calendar-blank" aria-hidden="true"></span>';
  for(let n=1;n<=count;n++){
    const key=dateKey(new Date(first.getFullYear(),first.getMonth(),n));
    const tasks=tasksOnCalendarDay(key);
    const done=tasks.filter(t=>Array.isArray(t.completedDates)&&t.completedDates.includes(key)).length;
    const classes=['calendar-day',key===today?'is-today':'',key===selectedDay?'is-selected':''].filter(Boolean).join(' ');
    grid+='<button type="button" class="'+classes+'" data-action="calendar-day" data-date="'+key+'" aria-pressed="'+String(key===selectedDay)+'" aria-label="'+esc(calendarDayName(key))+', '+tasks.length+' zadań">'
      +'<span class="day-number">'+n+'</span><span class="calendar-indicators">'
      +(tasks.length?'<span class="calendar-dot'+(done===tasks.length?' is-done':'')+'"></span>':'')
      +(tasks.length>1?'<span class="calendar-count">'+tasks.length+'</span>':'')
      +'</span></button>';
  }
  grid+='</div>';
  const tasks=tasksOnCalendarDay(selectedDay);
  let html=sectionHeader('Kalendarz','Twoje bloki, terminy i ukończone zadania.', '<button class="btn small secondary" data-action="calendar-today">Dziś</button>');
  html+='<section class="calendar-shell"><div class="calendar-nav"><button class="calendar-nav-btn" type="button" data-action="calendar-prev" aria-label="Poprzedni miesiąc">‹</button><strong>'+esc(monthName)+'</strong><button class="calendar-nav-btn" type="button" data-action="calendar-next" aria-label="Następny miesiąc">›</button></div>'+grid+'</section>';
  html+='<div class="calendar-selected"><div><strong>'+esc(calendarDayName(selectedDay))+'</strong><span>'+tasks.length+' '+(tasks.length===1?'blok':'bloków')+'</span></div><button class="btn small" data-action="calendar-add">+ Dodaj</button></div>';
  if(!tasks.length)return html+empty('Ten dzień jest wolny','Dodaj blok lub wybierz inną datę.', '✦');
  html+='<div class="calendar-agenda">';
  for(const t of tasks){
    const done=Array.isArray(t.completedDates)&&t.completedDates.includes(selectedDay);
    const stateLabel=done?'<span class="pill good">✓ Ukończone</span>':!t.enabled?'<span class="pill">Wyłączone</span>':t.date===null?'<span class="pill">Co tydzień</span>':'';
    const actions=selectedDay===today&&!done?taskActions(t):'<div class="task-actions">'
      +'<button class="btn small secondary" data-action="edit" data-collection="schedule" data-id="'+esc(t.id)+'">'+I('edit')+' Edytuj</button>'
      +'<button class="plain-icon" data-action="remove" data-collection="schedule" data-id="'+esc(t.id)+'" title="Usuń zadanie" aria-label="Usuń zadanie">'+I('trash')+'</button></div>';
    html+='<article class="task-card calendar-task" style="opacity:'+(t.enabled?1:'.55')+'"><div class="time">'+esc(t.time)+(t.endTime?'<div class="task-note">do '+esc(t.endTime)+'</div>':'')+'</div><div class="task-body"><div class="task-title">'+esc(t.title)+'</div><div class="calendar-meta">'+stateLabel+'</div><div class="task-note">'+esc(t.note||t.project||'')+'</div>'+actions+'</div></article>';
  }
  return html+'</div>';
}

function renderQuickLinks(limit){const items=state().links.slice(0,limit||100);return `<div class="link-grid">${items.map(x=>`<div class="link-card"><div class="link-top"><div class="link-symbol">${I(x.kind==='folder'?'folder':'link')}</div><button class="plain-icon" data-action="edit" data-collection="links" data-id="${esc(x.id)}" title="Edytuj">${I('edit')}</button><button class="plain-icon" data-action="remove" data-collection="links" data-id="${esc(x.id)}" title="Usuń">${I('trash')}</button></div><button class="plain-icon link-name" style="text-align:left;color:#e9f5ff;font-weight:700;font-size:12px;padding:0" data-action="open" data-kind="${esc(x.kind)}" data-target="${esc(x.target)}">${esc(x.title)}</button><span class="link-type">${esc(x.group||'Inne')}</span></div>`).join('')}</div>`;}
const labels={working:['Pracuje','blue'],needs_attention:['Czeka na Ciebie','amber'],ready:['Zgłoszone jako gotowe','green'],blocked:['Blokada','red'],idle:['Spoczynek','violet']};
function renderAgent(a){const [label,color]=labels[a.status]||labels.idle;return `<article class="agent-card"><div class="agent-head"><span class="agent-dot ${color}" style="color:var(--${color==='blue'?'blue':color==='green'?'green':color==='amber'?'amber':color==='red'?'red':'blue'})"></span><div class="agent-main"><strong>${esc(a.title)}</strong><div class="agent-meta"><span class="tag">${esc(a.tool||'AI')}</span><span class="tag">${a.source==='hook'?'Hook · automatycznie':'Ręcznie'}</span><span>${esc(label)}</span></div></div><button class="plain-icon" data-action="edit" data-collection="agents" data-id="${esc(a.id)}" title="Edytuj">${I('edit')}</button></div><div class="agent-note">${esc(a.note||'Brak notatki o postępie')}${a.branch?`<br><span class="quiet">Gałąź: ${esc(a.branch)}</span>`:''}</div><div class="inline-actions">${a.target?`<button class="btn tiny" data-action="open" data-kind="${esc(a.kind||'url')}" data-target="${esc(a.target)}">${I('external')} Przejdź do sesji</button>`:''}<button class="btn tiny ghost" data-action="remove" data-collection="agents" data-id="${esc(a.id)}">Usuń</button><span class="progress">${a.updatedAt?formatTime(a.updatedAt):''}</span></div></article>`;}
function renderFilteredAgents(){
  const all=state().agents, gh=snapshot.github;
  const titles={working:'Agenci w pracy',attention:'Wymaga uwagi',risk:'Ryzyka i błędy'};
  let html=sectionHeader(titles[agentFilter]||'Agenci','Widok otwarty z licznika statusów.','<button class="btn tiny secondary" data-action="filter-reset">Wszystkie</button>')+renderAgentGuide();
  if(agentFilter==='working'||agentFilter==='attention'){
    const selected=all.filter(a=>agentFilter==='working'?a.status==='working':a.status==='needs_attention'||a.status==='blocked');
    html+=selected.map(renderAgent).join('');
    const tasks=(state().coordinator?.jobs||[]).filter(j=>agentFilter==='working'?j.status==='running':j.status==='attention');
    const chatTasks=(state().chatgptRuns||[]).filter(j=>agentFilter==='working'?['queued','in_progress','suspended'].includes(j.status):['attention','failed'].includes(j.status));
    const signalTasks=(state().chatgptSignals||[]).filter(j=>agentFilter==='working'?j.status==='working':j.status==='needs_attention');
    html+=tasks.map(j=>'<article class="agent-card"><div class="task-title">Koordynator: '+esc(j.title)+'</div><p class="task-note">'+esc(j.status==='running'?'Przekazywanie między agentami trwa':'Brak dalszego wykonawcy, sprawdź zadanie')+'</p><button class="btn tiny secondary" data-action="filter-reset">Otwórz centrum agentów</button></article>').join('');
    html+=chatTasks.map(j=>'<article class="agent-card"><strong>ChatGPT: '+esc(j.title)+'</strong><p class="task-note">'+esc(j.status)+'</p>'+(j.conversationUrl?'<button class="btn tiny secondary" data-action="open" data-kind="url" data-target="'+esc(j.conversationUrl)+'">Otwórz ChatGPT</button>':'')+'</article>').join('');
    html+=signalTasks.map(j=>'<article class="agent-card"><strong>ChatGPT (wtyczka): '+esc(j.title)+'</strong><p class="task-note">'+esc(j.status)+'</p></article>').join('');
    if(!selected.length&&!tasks.length&&!chatTasks.length&&!signalTasks.length)html+=empty('Brak agentów','Żadna sesja nie ma teraz tego statusu.','✓');
    if(agentFilter==='working'){
      const running=(gh?.runs||[]).filter(x=>x.status!=='completed');
      html+=running.map(x=>'<div class="pr-card"><div class="pr-title">'+esc(x.name||'GitHub Actions')+' · CI trwa</div><button class="btn tiny secondary" data-action="open" data-kind="url" data-target="'+esc(x.html_url)+'">Otwórz</button></div>').join('');
    }
    return html;
  }
  const failed=(gh?.runs||[]).filter(x=>['failure','timed_out','action_required'].includes(x.conclusion));
  const overlaps=gh?.overlapping||[];
  const blocked=all.filter(x=>x.status==='blocked');
  html+=failed.map(x=>'<div class="alert danger">'+I('alert')+' <div>'+esc(x.name||'GitHub Actions')+' — '+esc(x.conclusion)+' <button class="btn tiny" data-action="open" data-kind="url" data-target="'+esc(x.html_url)+'">Sprawdź CI</button></div></div>').join('');
  html+=overlaps.map(x=>{
    const repo=state().settings.repo;
    return '<div class="alert">'+I('alert')+' <div>Możliwe nakładanie plików: '+esc(x.files.join(', '))+'<div class="inline-actions"><button class="btn tiny secondary" data-action="open" data-kind="url" data-target="https://github.com/'+esc(repo)+'/pull/'+Number(x.a)+'">PR #'+Number(x.a)+'</button><button class="btn tiny secondary" data-action="open" data-kind="url" data-target="https://github.com/'+esc(repo)+'/pull/'+Number(x.b)+'">PR #'+Number(x.b)+'</button></div></div></div>';
  }).join('');
  html+=blocked.map(renderAgent).join('');
  if(!failed.length&&!overlaps.length&&!blocked.length)html+=empty('Brak wykrytych ryzyk','Na podstawie ostatniego odczytu GitHuba i sesji agentów.','✓');
  if(snapshot.githubError)html+='<div class="alert danger">'+esc(snapshot.githubError)+'</div>';
  return html;
}


const agentGuideSteps=[
  {
    icon:'glasses',
    title:'Poznaj dwa tryby pracy',
    body:'Obserwowanie pokazuje status istniejącej sesji AI. Koordynator uruchamia osobne, lokalne etapy analizy i recenzji. To dwie różne funkcje.',
    note:'Claude Code wysyła hooki, a Workspace Agent ChatGPT ma oficjalne statusy API. Zwykła rozmowa ChatGPT nie udostępnia takiego sygnału.'
  },
  {
    icon:'edit',
    title:'Opisz pierwsze zadanie',
    body:'W Koordynatorze wpisz tytuł i cel, wybierz folder projektu oraz drugiego wykonawcę: Claude Code lub Codex CLI.',
    note:'Dodanie zadania zapisuje je w kolejce. Dopiero świadome włączenie Koordynatora może uruchomić agentów i zużyć ich limity.'
  },
  {
    icon:'bell',
    title:'Odbierz wynik, nie każdy sygnał',
    body:'Śledź statusy: Oczekuje → Agent analizuje → Analizy gotowe. Po zakończeniu otwórz raporty obu agentów.',
    note:'Ratchet powiadomi Cię po obu etapach lub przy blokadzie. Raport nie oznacza wdrożenia kodu.'
  }
];
function renderAgentGuide(){
  if(agentGuideSeen&&!agentGuideOpen){
    return '<div class="agent-guide-reopen"><button type="button" class="btn tiny ghost" data-action="agent-guide-restart">'
      +I('bot')+' Jak korzystać z agentów?</button></div>';
  }
  const step=agentGuideSteps[agentGuideStep],last=agentGuideStep===agentGuideSteps.length-1;
  return '<section class="agent-guide" aria-label="Samouczek centrum agentów">'
    +'<div class="agent-guide-top"><span class="agent-guide-kicker">POZNAJ KOORDYNATORA</span>'
    +'<span class="agent-guide-position">Krok '+(agentGuideStep+1)+' z '+agentGuideSteps.length+'</span></div>'
    +'<div class="agent-guide-progress" role="progressbar" aria-label="Postęp samouczka" aria-valuemin="1" aria-valuemax="3" aria-valuenow="'+(agentGuideStep+1)+'">'
    +agentGuideSteps.map((_,i)=>'<span class="'+(i<=agentGuideStep?'active':'')+'"></span>').join('')+'</div>'
    +'<div class="agent-guide-icon">'+I(step.icon)+'</div>'
    +'<h2>'+esc(step.title)+'</h2>'
    +'<p class="agent-guide-description">'+esc(step.body)+'</p>'
    +'<p class="agent-guide-note">'+I('shield')+' '+esc(step.note)+'</p>'
    +'<div class="agent-guide-controls"><button type="button" class="btn tiny ghost" data-action="agent-guide-skip">Pomiń</button>'
    +'<div class="agent-guide-right">'
    +(agentGuideStep?'<button type="button" class="btn tiny secondary" data-action="agent-guide-back">Wstecz</button>':'')
    +'<button type="button" class="btn small" data-action="agent-guide-next">'+(last?'Zakończ samouczek':'Dalej')+I(last?'check':'arrow')+'</button>'
    +'</div></div></section>';
}



function renderChatGPTSignals(){
  const signals=state().chatgptSignals||[];
  let html='<div class="group-title"><h3>ChatGPT · sygnały z wtyczki</h3><span class="quiet">Raportowane przez model</span></div>';
  html+='<div class="workspace-help">Po podłączeniu prywatnej wtyczki Ratchet ChatGPT może wysłać sygnał rozpoczęcia, ukończenia lub blokady. '
    +'To nie jest niezależne potwierdzenie zakończenia odpowiedzi przez platformę ChatGPT. '
    +'Wtyczka musi faktycznie wywołać narzędzie — samo zamknięcie rozmowy nie uruchamia alertu.</div>';
  for(const item of signals.slice(0,8)){
    const labels={working:'Zgłosił rozpoczęcie',reported_done:'Zgłosił ukończenie',needs_attention:'Wymaga uwagi'};
    html+='<article class="workspace-run"><div class="coordinator-job-head"><strong>'+esc(item.title)+'</strong><span class="pill '+(item.status==='needs_attention'?'bad':item.status==='reported_done'?'good':'')+'">'+esc(labels[item.status]||item.status)+'</span></div>'
      +(item.note?'<p class="task-note">'+esc(item.note)+'</p>':'')+'<div class="inline-actions">'
      +(item.conversationUrl?'<button class="btn tiny secondary" data-action="open" data-kind="url" data-target="'+esc(item.conversationUrl)+'">Otwórz rozmowę</button>':'')
      +(item.status!=='working'?'<button class="btn tiny ghost" data-action="chatgpt-signal-remove" data-id="'+esc(item.id)+'">Usuń wpis</button>':'')
      +'</div></article>';
  }
  return html;
}

function renderChatGPTWorkspace(){
  const jobs=state().chatgptRuns||[],ready=snapshot.chatgptWorkspaceReady===true;
  let html='<div class="group-title"><h3>ChatGPT · prawdziwe statusy</h3><span class="quiet">Workspace Agents API</span></div>';
  html+='<section class="chatgpt-workspace"><div class="workspace-head"><div><strong>Uruchom i monitoruj agenta ChatGPT</strong>'
    +'<p class="hint">Odczytujemy status z API ChatGPT, nie zgadujemy z przeglądarki. Zwykłe rozmowy ChatGPT nie są tutaj automatycznie monitorowane.</p></div>'
    +'<span class="pill '+(ready?'good':'')+'">'+(ready?'Połączono token':'Brak tokenu')+'</span></div>';
  if(!ready){
    html+='<div class="workspace-help">Dostęp wymaga opublikowanego Workspace Agent z kanałem API i osobnego tokenu Workspace Agents. '
      +'Ustaw <code>RATCHET_WORKSPACE_AGENT_TOKEN</code> w środowisku aplikacji, a następnie uruchom testowego Ratcheta ponownie. '
      +'Nie wklejaj tokenu do formularza zadania. Integracja jest wyłączona, dopóki nie ma tokenu.</div>';
  }
  html+='<form id="chatgptWorkspaceForm" class="coordinator-form">'
    +'<input name="title" aria-label="Nazwa zadania ChatGPT" placeholder="Np. Audyt UX City Route" required maxlength="160" '+(!ready?'disabled':'')+'>'
    +'<input name="triggerId" aria-label="Identyfikator kanału agenta ChatGPT" placeholder="agtch_..." required pattern="agtch_[A-Za-z0-9_-]{3,160}" '+(!ready?'disabled':'')+'>'
    +'<textarea name="input" aria-label="Polecenie dla agenta ChatGPT" placeholder="Co dokładnie ma sprawdzić agent?" required minlength="12" maxlength="5000" '+(!ready?'disabled':'')+'></textarea>'
    +'<button type="submit" class="btn small full" '+(!ready?'disabled':'')+'>Uruchom agenta ChatGPT i śledź wynik</button></form>';
  html+='<p class="hint">Uruchomienie może zużywać limity lub środki przypisane do Workspace Agent. Status „Ukończone” to koniec uruchomienia, nie dowód wdrożenia zmian.</p></section>';
  if(!jobs.length)return html;
  html+='<div class="workspace-runs-head"><span>Ostatnie uruchomienia · '+jobs.length+'</span><button class="btn tiny ghost" data-action="chatgpt-refresh" '+(!ready?'disabled':'')+'>'+I('refresh')+' Sprawdź statusy</button></div>';
  for(const j of jobs.slice(0,12)){
    const labels={submitting:'Wysyłanie',queued:'W kolejce',in_progress:'Pracuje',suspended:'Czeka na działanie',completed:'Ukończone',failed:'Błąd',attention:'Wymaga uwagi'};
    const color=j.status==='completed'?'good':j.status==='failed'||j.status==='attention'?'bad':'';
    html+='<article class="workspace-run"><div class="coordinator-job-head"><strong>'+esc(j.title)+'</strong><span class="pill '+color+'">'+esc(labels[j.status]||j.status)+'</span></div>'
      +(j.reason?'<p class="task-note workspace-reason">'+esc(j.reason)+'</p>':'')
      +'<div class="inline-actions">';
    if(j.conversationUrl)html+='<button class="btn tiny secondary" data-action="open" data-kind="url" data-target="'+esc(j.conversationUrl)+'">'+I('external')+' Otwórz rozmowę</button>';
    if(j.status==='attention'&&j.runId&&ready)html+='<button class="btn tiny secondary" data-action="chatgpt-resume" data-id="'+esc(j.id)+'">Wznów sprawdzanie</button>';
    if(!['submitting','queued','in_progress','suspended'].includes(j.status))html+='<button class="btn tiny ghost" data-action="chatgpt-remove" data-id="'+esc(j.id)+'">Usuń z historii</button>';
    html+='</div></article>';
  }
  return html;
}

function renderCoordinator(){
  const c=state().coordinator||{enabled:false,jobs:[]};
  const running=(c.jobs||[]).filter(j=>j.status==='running').length;
  let html='<div class="group-title"><h3>Koordynator · Beta</h3><span class="quiet">'+running+'/2 pracuje</span></div>';
  html+='<div class="coordinator-box"><div class="coordinator-top"><div><strong>Przekazywanie agent → agent</strong><p class="hint">2 etapy: analiza Claude Code → recenzja Claude Code lub Codex CLI. Odczyt repo, bez zapisu, commitów i wdrożeń.</p></div>'
    +'<button class="btn small '+(c.enabled?'danger':'secondary')+'" data-action="coordinator-toggle" data-enabled="'+String(!c.enabled)+'">'+(c.enabled?'Wyłącz nowe':'Włącz')+'</button></div>';
  html+='<form id="coordinatorForm" class="coordinator-form">'
    +'<input name="title" aria-label="Tytuł zadania" placeholder="Np. Audyt zdjęć City Route" maxlength="120" required>'
    +'<textarea name="goal" aria-label="Cel analizy" placeholder="Opisz, co mają przeanalizować i zweryfikować agenci. Minimum 15 znaków." required minlength="15" maxlength="3000"></textarea>'
    +'<input name="projectRoot" aria-label="Folder projektu Windows" placeholder="C:\\Users\\...\\city-route-app" required>'
    +'<select name="reviewer" aria-label="Drugi wykonawca"><option value="claude">Recenzja: drugi Claude Code</option><option value="codex">Recenzja: Codex CLI (jeśli zainstalowany)</option></select>'
    +'<button class="btn small full" type="submit">+ Zleć analizę i recenzję</button></form>'
    +'<p class="hint">Tryb wykonawczy domyślnie wyłączony. Claude ma szacowany limit $0.35 na etap (może zostać przekroczony). Codex zużywa limity swojego konta i nie ma limitu USD w Ratchecie. Maks. 2 zadania równolegle. Nie steruje otwartymi rozmowami ChatGPT.</p></div>';
  for(const job of (c.jobs||[]).slice(0,8)){
    const names={queued:'Oczekuje',running:'Agent analizuje',attention:'Wymaga uwagi',done:'Analizy gotowe',cancelled:'Anulowano'};
    const steps=job.stages||[];
    html+='<article class="coordinator-job"><div class="coordinator-job-head"><strong>'+esc(job.title)+'</strong><span class="pill '+(job.status==='done'?'good':job.status==='attention'?'bad':'')+'">'+(names[job.status]||esc(job.status))+'</span></div>'
      +'<p class="task-note">'+esc(job.goal)+'</p>'
      +'<div class="coordinator-stages">'+steps.map((st,i)=>'<span class="'+(st.status==='done'?'is-done':st.status==='running'?'is-active':'')+'">'+(i===0?'1 Analiza':'2 Recenzja')+' · '+esc(st.status)+'</span>').join('')+'</div>';
    const current=steps[job.stepIndex]||steps[steps.length-1];
    if(job.status==='attention')html+='<p class="alert danger">'+I('alert')+esc(current?.error||'Brak dalszego wykonawcy')+'</p>';
    if(job.status==='done')html+='<details class="coordinator-report"><summary>Pokaż raporty agentów</summary>'+steps.map(st=>'<p><strong>'+esc(st.role==='analysis'?'Analiza':'Recenzja')+'</strong></p><pre>'+esc(st.summary||'Brak raportu')+'</pre>').join('')+'</details>';
    html+='<div class="inline-actions">';
    if(job.status==='attention'&&!current?.retryUsed)html+='<button class="btn tiny secondary" data-action="coordinator-retry" data-id="'+esc(job.id)+'">Ponów raz</button>';
    if(job.status!=='running')html+='<button class="btn tiny ghost" data-action="coordinator-remove" data-id="'+esc(job.id)+'">Usuń</button>';
    html+='</div></article>';
  }
  return html;
}

function renderAgents(){
  if(agentFilter)return renderFilteredAgents();
  const a=state().agents,gh=snapshot.github,err=snapshot.githubError;
  let html=sectionHeader('Centrum agentów','Model zakończył odpowiedź ≠ kod jest sprawdzony.',`<button class="btn small secondary" data-action="new" data-collection="agents">+ Agent</button>`);
  html+=renderAgentGuide();
  html+=`<div class="github-summary"><div class="github-top"><div><strong>GitHub · ${esc(state().settings.repo)}</strong><br><small>${gh?.checkedAt?`Odczyt: ${formatTime(gh.checkedAt)}`:'Bez ostatniego odczytu'}</small></div><button class="btn small secondary" data-action="github-refresh">${I('refresh')} Odśwież</button></div>`;
  if(gh)html+=`<div class="github-stats"><div class="metric"><b>${gh.prs.length}</b><span>Otwarte PR</span></div><div class="metric"><b>${gh.runs.filter(r=>r.status!=='completed').length}</b><span>CI w toku</span></div><div class="metric"><b>${gh.runs.filter(r=>r.conclusion==='failure').length}</b><span>CI błędy</span></div></div>`;
  else html+=`<p class="sub">${esc(err||'Łączenie z GitHubem...')}</p>`;
  html+='</div>';
  if(err)html+=`<div class="alert danger">${I('alert')} ${esc(err)}. Publiczne repozytoria są odczytywane bez tokena; prywatne nie są dostępne w tej wersji.</div>`;
  if(gh?.overlapping?.length)html+=gh.overlapping.map(x=>`<div class="alert">${I('alert')} PR #${x.a} i #${x.b} dotykają tych samych plików: <strong>${esc(x.files.join(', '))}</strong>. To ostrzeżenie o nakładaniu zmian, nie potwierdzony konflikt merge.</div>`).join('');
  html+=renderCoordinator();
  html+=renderChatGPTWorkspace();
  html+=renderChatGPTSignals();
  html+=`<div class="group-title"><h3>Sesje modeli · ${a.length}</h3><span class="quiet">Statusy nie weryfikują testów</span></div>`;
  html+=a.length?a.map(renderAgent).join(''):empty('Nie monitorujesz jeszcze sesji','Dodaj rozmowę ChatGPT / Claude lub podłącz Claude Code Hooks.','◇');
  if(gh){html+=`<div class="group-title"><h3>Otwarte PR-y · ${gh.prs.length}</h3></div>`;html+=gh.prs.length?gh.prs.map(p=>{const related=gh.runs.filter(r=>r.head_sha===p.head_sha);const fail=related.some(r=>r.conclusion==='failure');return `<div class="pr-card"><div class="pr-row"><div><div class="pr-title"><span class="pr-number">#${p.number}</span> ${esc(p.title)}</div><div class="pr-branch">${esc(p.branch)}</div></div><button class="btn tiny ${fail?'danger':'secondary'}" data-action="open" data-kind="url" data-target="${esc(p.html_url)}">${fail?'CI błąd':'Otwórz'} ${I('arrow')}</button></div></div>`;}).join(''):empty('Czysta lista PR-ów','Nie ma obecnie otwartych PR-ów w monitorowanym repozytorium.','✓');}
  html+=`<div class="group-title"><h3>Przekazanie kontekstu</h3></div><p class="sub">Zbierze sesje, PR-y, wyniki CI i ryzyka do jednego polecenia. Przed kolejnym zadaniem przekaż je modelowi.</p><button class="btn full" style="margin-top:11px" data-action="handoff">${I('copy')} Skopiuj handoff do agenta</button><p class="hint">Integracja Claude Code Hooks aktualizuje stan sesji. ChatGPT w przeglądarce dodajesz ręcznie — Ratchet nie czyta ukrytego przebiegu rozmów.</p>`;
  if(gh?.partialFiles)html+=`<p class="hint">Uwaga: porównano pliki tylko pierwszych 4 PR-ów. Brak ostrzeżenia nie gwarantuje braku nakładania.</p>`;
  return html;
}
function renderLinks(){return sectionHeader('Szybkie skróty','Prosto do czatu, projektu, sklepu lub folderu.',`<button class="btn small secondary" data-action="new" data-collection="links">+ Skrót</button>`)+renderQuickLinks()+`<p class="hint" style="margin-top:15px">Skróty do folderów działają w aplikacji Windows. Wklej pełną ścieżkę, np. C:\\Users\\...\\Documents.</p>`;}
function renderUpdates(){
  const available=!!updateInfo?.available;
  return `<div class="settings-group update-group"><h3>Aktualizacje Ratcheta</h3>
  <p class="hint">Zainstalowana wersja: <strong>0.2.9</strong>. Kolejne wersje instaluj z tego panelu — bez rozpakowywania kolejnych ZIP-ów.</p>
  ${available?`<p class="update-ready">Dostępna wersja ${esc(updateInfo.version)}: ${esc(updateInfo.notes)}</p><button class="btn full" type="button" data-action="update-install">${I('download')} Zainstaluj ${esc(updateInfo.version)}</button>`:
  `<button class="btn secondary full" type="button" data-action="update-check">${I('refresh')} Sprawdź aktualizacje</button>`}
  <p class="hint">Kanał GitHub jest prywatny. Działa przez GitHub CLI po jednorazowym zalogowaniu (gh auth login). Nowe pliki są weryfikowane SHA-256. Brak zalogowania nie wpływa na pozostałe funkcje Ratcheta.</p></div>`;
}
function renderSettings(){const s=state().settings;return sectionHeader('Ustawienia','Ratchet mieszka na Twoim komputerze.')+`<form id="settingsForm"><div class="settings-group"><h3>Monitorowany projekt GitHub</h3><div class="field"><label for="repo">Repozytorium (właściciel/nazwa)</label><input id="repo" name="repo" value="${esc(s.repo)}" placeholder="Zyczinho/city-route-app" required></div><p class="hint">Publiczne repozytorium. Odświeżanie co 10 minut; ręczne również dostępne.</p></div><div class="settings-group"><h3>Wygląd Ratcheta</h3><div class="field"><label for="avatarSize">Rozmiar kuleczki na ekranie</label><select id="avatarSize" name="avatarSize"><option value="48" ${Number(s.avatarSize||84)===48?'selected':''}>Mini — 48 px</option><option value="56" ${Number(s.avatarSize||84)===56?'selected':''}>Mały — 56 px</option><option value="64" ${Number(s.avatarSize||84)===64?'selected':''}>Średni — 64 px</option><option value="72" ${Number(s.avatarSize||84)===72?'selected':''}>Mały — 72 px</option><option value="84" ${Number(s.avatarSize||84)===84?'selected':''}>Kompaktowy — 84 px (domyślny)</option><option value="100" ${Number(s.avatarSize||84)===100?'selected':''}>Większy — 100 px</option><option value="112" ${Number(s.avatarSize||84)===112?'selected':''}>Klasyczny — 112 px</option></select></div><p class="hint">Po zapisaniu kuleczka zmieni rozmiar w ciągu kilku sekund, bez ponownego uruchamiania Ratcheta. W kolejnych wersjach pojawią się różne buźki, kolory i animacje.</p></div><div class="settings-group"><h3>Zachowanie</h3><label class="checkbox-row"><input type="checkbox" name="notifications" ${s.notifications?'checked':''}> Powiadomienia systemowe</label><button type="button" class="btn secondary small" data-action="notification-test">${I('bell')} Wyślij test powiadomienia Windows</button><label class="checkbox-row"><input type="checkbox" name="alwaysOnTop" ${s.alwaysOnTop?'checked':''}> Kuleczka zawsze na wierzchu</label><label class="checkbox-row"><input type="checkbox" name="autoStart" ${s.autoStart?'checked':''}> Uruchamiaj Ratchet wraz z Windows</label><div class="inline-actions"><button type="button" class="btn secondary small" data-action="reset-orb">Przenieś kuleczkę na ekran główny</button><button type="button" class="btn secondary small" data-action="reset-panel-size">Przywróć mały panel</button></div><p class="hint">Rozmiar panelu możesz zmienić, przeciągając jego krawędź — Ratchet go zapamięta.</p></div><button class="btn full" type="submit">Zapisz ustawienia</button></form>${renderUpdates()}<div class="group-title"><h3>O integracjach</h3></div><div class="settings-group"><div class="keyvalue"><strong>GitHub</strong><span>API · odczyt</span></div><div class="keyvalue"><strong>Claude Code</strong><span>Hook na 127.0.0.1:47822</span></div><div class="keyvalue"><strong>ChatGPT / Claude Web</strong><span>Skróty + ręczne statusy</span></div><div class="keyvalue"><strong>Zadania</strong><span>Plik lokalny JSON</span></div><div class="separator"></div><p class="hint">Dane zapisują się w profilu Windows użytkownika Ratchet. Bez synchronizacji chmurowej. Ratchet nie wysyła automatycznie promptów i nie scala kodu.</p></div>${DEMO?`<div class="alert">Tryb podglądu przeglądarkowego. Aby używać kuleczki, powiadomień systemowych i folderów, uruchom aplikację Windows.</div>`:''}`;}
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
function render(){updateClock();renderStrip();document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));$('#view').innerHTML=tab==='today'?renderToday():tab==='calendar'?renderCalendar():tab==='agents'?renderAgents():tab==='links'?renderLinks():renderSettings();window.ratchetHydrateIcons?.(document);}
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
    fields+=input('project','Projekt',item.project,'placeholder="Np. City Route"');
    fields+=`<p class="hint">Ratchet przypomni o rozpoczęciu i planowanym końcu bloku. Jeśli zakończysz wcześniej, kliknij „Zakończ”.</p>`;
    fields+=select('repeat','Kiedy?',item.date===null?'weekly':'once',[['once','Jednorazowo'],['weekly','Co tydzień']]);
    fields+=`<div id="onceFields">${input('date','Data',item.date||dateKey(),'type="date" required')}</div>`;
    fields+=`<div class="field" id="weeklyFields"><label>Dni tygodnia (cyklicznie)</label><div class="weekday-row">${[1,2,3,4,5,6,0].map(d=>`<label class="daycheck"><input type="checkbox" name="days" value="${d}" ${days.includes(d)?'checked':''}><span>${weekdays[d]}</span></label>`).join('')}</div></div>`;
    fields+=select('kind','Typ celu',item.kind||'url',[['url','Link do strony / czatu / spotkania'],['folder','Folder / plik Windows']]);
    fields+=input('target','Otwórz jednym kliknięciem',item.target,'placeholder="https://... lub C:\\Users\\..."');
    fields+=`<div class="field"><label for="field-note">Notatka (opcjonalnie)</label><textarea id="field-note" name="note" placeholder="Co dokładnie masz zrobić?">${esc(item.note||'')}</textarea></div>`;
    fields+=`<label class="checkbox-row"><input type="checkbox" name="enabled" ${item.enabled!==false?'checked':''}> Aktywne przypomnienia</label>`;
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
  $('#itemForm').dataset.collection=collection;$('#itemForm').dataset.id=id;
  $('#itemForm').innerHTML=fields+`<div class="form-actions"><button class="btn secondary" type="button" data-action="modal-close">Anuluj</button><button class="btn" type="submit">${id?'Zapisz zmiany':'Dodaj'}</button></div>`;
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
  if(act==='calendar-prev'||act==='calendar-next'){
    const shift=act==='calendar-next'?1:-1;
    calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+shift,1);
    selectedDay=dateKey(calendarMonth);
    render();
  }
  if(act==='calendar-day'){
    const key=el.dataset.date;
    if(/^\d{4}-\d{2}-\d{2}$/.test(key)){selectedDay=key;render();}
  }
  if(act==='calendar-today'){
    selectedDay=dateKey();calendarMonth=new Date(now().getFullYear(),now().getMonth(),1);render();
  }
  if(act==='calendar-add')showModal('schedule','',{date:selectedDay,time:'09:00'});
  if(act==='template')showModal('schedule','',templateMap[el.dataset.template]);
  if(act==='switch'){tab=el.dataset.tab;agentFilter=null;render();}
  if(act==='metric'){tab='agents';agentFilter=el.dataset.metric;render();}
  if(act==='agent-guide-restart'){agentGuideOpen=true;agentGuideStep=0;render();}
  if(act==='agent-guide-skip'){finishAgentGuide();render();}
  if(act==='agent-guide-back'){agentGuideStep=Math.max(0,agentGuideStep-1);render();}
  if(act==='agent-guide-next'){
    if(agentGuideStep===agentGuideSteps.length-1){finishAgentGuide();render();}
    else{agentGuideStep=Math.min(agentGuideSteps.length-1,agentGuideStep+1);render();}
  }
  if(act==='chatgpt-signal-remove'){
    if(!await compactConfirm('Usunąć sygnał z historii? Nie usuwa rozmowy ChatGPT.'))return;
    await bridge.chatgptSignalRemove(id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Sygnał usunięty');
  }
  if(act==='chatgpt-refresh'){
    await bridge.chatgptRefresh();if(!DEMO)snapshot=await bridge.snapshot();render();toast('Statusy ChatGPT sprawdzone');
  }
  if(act==='chatgpt-resume'){
    await bridge.chatgptResume(id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Monitorowanie wznowione');
  }
  if(act==='chatgpt-remove'){
    if(!await compactConfirm('Usunąć wpis z monitora? Nie usuwa to rozmowy ani agenta ChatGPT.'))return;
    await bridge.chatgptRemove(id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Wpis usunięty');
  }
  if(act==='coordinator-toggle'){
    const enabled=el.dataset.enabled==='true';
    if(enabled&&!await compactConfirm('Włączyć uruchamianie lokalnych agentów Claude Code? Dwa etapy analizy mogą wykorzystać płatne zapytania. Bez edycji kodu.'))return;
    await bridge.coordinatorEnable(enabled);
    if(!DEMO)snapshot=await bridge.snapshot();
    render();toast(enabled?'Koordynator uruchomiony':'Nowe zadania wstrzymane');
  }
  if(act==='coordinator-retry'){
    await bridge.coordinatorRetry(id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Ponowienie zlecone (maks. raz)');
  }
  if(act==='coordinator-remove'){
    if(!await compactConfirm('Usunąć zadanie koordynatora wraz z raportami?'))return;
    await bridge.coordinatorRemove(id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Zadanie usunięte');
  }
  if(act==='filter-reset'){agentFilter=null;render();}
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
    await bridge.remove(col,id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Usunięto');
  }
  if(act==='schedule-start'||act==='schedule-snooze'||act==='schedule-finish'){
    await bridge.scheduleAction(id,act==='schedule-start'?'start':act==='schedule-finish'?'finish':'snooze');
    if(!DEMO)snapshot=await bridge.snapshot();render();toast(act==='schedule-start'?'Działamy! ✦':act==='schedule-finish'?'Zakończono ✓':'Przypomnę za 10 minut');
  }
  if(act==='open'){await bridge.open(el.dataset.kind,el.dataset.target);toast('Otwieram ↗');}
  if(act==='github-refresh'){toast('Sprawdzam GitHub…');const result=await bridge.refreshGithub();snapshot={...snapshot,...result};render();if(result.githubError)toast(result.githubError);else toast('GitHub zaktualizowany');}
  if(act==='handoff'){await bridge.handoff();toast('Handoff skopiowany do schowka ✓');}
  if(act==='diagnose'){await bridge.diagnose();$('#appMenu').hidden=true;toast('Zlecono lokalną diagnostykę. Raport otworzy się na komputerze.');}
  if(act==='update-check'){
    tab='settings';render();toast('Sprawdzam kanał aktualizacji…');
    updateInfo=await bridge.checkUpdate();
    render();toast(updateInfo.available?'Dostępna aktualizacja '+updateInfo.version:'Masz aktualną wersję ✓');
  }
  if(act==='update-install'){
    if(!await compactConfirm('Zainstalować Ratchet '+updateInfo.version+'? Aplikacja uruchomi się ponownie, a Twoje zadania pozostaną zapisane.'))return;
    toast('Pobieram i weryfikuję aktualizację…');
    await bridge.installUpdate();
    toast('Ratchet uruchomi się ponownie.');
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
    if(!await compactConfirm('Zakończyć Ratchet? Kuleczka i przypomnienia przestaną działać do ponownego uruchomienia.'))return;
    await bridge.quit();
    $('#appMenu').hidden=true;
    if(!DEMO){
      $('#view').innerHTML='<div class="empty"><div class="empty-emoji">✓</div><strong>Ratchet zakończył pracę</strong><p>Zadania i skróty są bezpiecznie zapisane. Możesz zamknąć to okno.</p></div>';
      $('#statusStrip').innerHTML='';
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
  if(tabButton){tab=tabButton.dataset.tab;agentFilter=null;render();return;}
  const a=e.target.closest('[data-action]');if(a)safe(()=>handleAction(a));
});
document.addEventListener('submit',e=>{
  if(e.target.id==='chatgptWorkspaceForm'){
    e.preventDefault();safe(async()=>{
      if(!snapshot.chatgptWorkspaceReady)throw Error('Nie podłączono tokenu Workspace Agents.');
      const fd=new FormData(e.target);
      const data={title:String(fd.get('title')||'').trim(),triggerId:String(fd.get('triggerId')||'').trim(),input:String(fd.get('input')||'').trim()};
      if(!await compactConfirm('Uruchomić Workspace Agent ChatGPT? To nowe zlecenie i może zużywać limity konta.'))return;
      const outcome=await bridge.chatgptCreate(data);
      if(!DEMO)snapshot=await bridge.snapshot();
      render();
      toast(outcome.status==='queued'?'Agent ChatGPT przyjął zadanie':'Sprawdź status zlecenia w panelu');
    });
  }
  if(e.target.id==='coordinatorForm'){
    e.preventDefault();safe(async()=>{
      const fd=new FormData(e.target);
      await bridge.coordinatorCreate({
        title:String(fd.get('title')||'').trim(),
        goal:String(fd.get('goal')||'').trim(),
        projectRoot:String(fd.get('projectRoot')||'').trim(),
        reviewer:String(fd.get('reviewer')||'claude')
      });
      if(!DEMO)snapshot=await bridge.snapshot();
      render();toast('Zadanie dodane do kolejki koordynatora');
    });
  }
  if(e.target.id==='itemForm'){e.preventDefault();safe(()=>saveForm(e.target));}
  if(e.target.id==='quickPlanForm'){e.preventDefault();safe(async()=>{const raw=String(new FormData(e.target).get('phrase')||'');const match=raw.match(/(?:^|\s)(?:o(?:d)?\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?(?=\s|$)/i);if(!match)throw Error('Dodaj godzinę, np. o 12:00 spotkanie');const hh=pad(Number(match[1])),mm=match[2]||'00';const title=raw.replace(match[0],' ').replace(/\b(dzisiaj|jutro)\b/ig,'').replace(/^\s*[-–:,]\s*/,'').trim();if(!title)throw Error('Napisz też, co masz zrobić');const d=now();if(/\bjutro\b/i.test(raw))d.setDate(d.getDate()+1);const l=title.toLowerCase();let target='';if(/city\s*route|cityroad|city\s*road/i.test(l))target='https://github.com/Zyczinho/city-route-app';else if(/box\s*2\s*box|box2box|box\s*to\s*box/i.test(l))target='https://box2box.com.pl';else if(/szuk.*prac|ofert.*prac/i.test(l))target=/portal|ogłoszen|ogloszen/i.test(l)?'https://justjoin.it/':'https://chatgpt.com/';const url=title.match(/https?:\/\/[^\s]+/i);if(url)target=url[0];await bridge.save('schedule',{title,time:`${hh}:${mm}`,endTime:plusMinutes(`${hh}:${mm}`),date:dateKey(d),days:[d.getDay()],target,kind:'url',enabled:true});if(!DEMO)snapshot=await bridge.snapshot();if(dateKey(d)!==dateKey()){selectedDay=dateKey(d);calendarMonth=new Date(d.getFullYear(),d.getMonth(),1);tab='calendar';}e.target.reset();render();toast('Dodano do planu ✓');});}
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
safe(async()=>{snapshot=await bridge.snapshot();if(DEMO)persistDemo();render();if(!DEMO){try{updateInfo=await bridge.checkUpdate();if(updateInfo.available){document.body.classList.add('update-available');toast('Nowy Ratchet '+updateInfo.version+' — otwórz Ustawienia');}}catch(e){console.info('Ratchet update check:',e.message);}}});
setInterval(()=>{updateClock();if(tab==='today')render();},30000);
