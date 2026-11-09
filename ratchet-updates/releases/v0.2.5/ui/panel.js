'use strict';
const DEMO = !window.ratchet;
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
    ],agents:[],activity:[],reminded:{}
  },github:null,githubError:'Podgląd przeglądarkowy — monitorowanie GitHuba działa w aplikacji Windows.'
};
const loadDemo=()=>{try{return JSON.parse(localStorage.getItem('ratchet-demo'))||demoInitial;}catch{return demoInitial;}};
const persistDemo=()=>{try{localStorage.setItem('ratchet-demo',JSON.stringify(snapshot));}catch{/* Podgląd osadzony może blokować storage — wtedy działa w pamięci. */}};
let snapshot=DEMO?loadDemo():demoInitial,tab='today',toastTimer,updateInfo=null;
const state=()=>snapshot.state;
const $=sel=>document.querySelector(sel);
const I=(name)=>`<span class="icon-slot" data-icon="${name}"></span>`;
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const short=v=>{const s=String(v??'');return s.length>54?s.slice(0,51)+'…':s;};
const now=()=>new Date();
const dateKey=(d=now())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const weekdays=['Nd','Pn','Wt','Śr','Cz','Pt','Sb'];
const pad=n=>String(n).padStart(2,'0');
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
  saveSettings:async data=>{state().settings={...state().settings,...data};persistDemo();},
  scheduleAction:async(id,action)=>{const t=state().schedule.find(x=>x.id===id);if(action==='snooze')t.snoozeUntil=new Date(Date.now()+600000).toISOString();if(action==='start'&&t.target)window.open(t.target,'_blank','noopener,noreferrer');persistDemo();},
  open:async(kind,target)=>{if(kind==='folder')throw Error('Otwieranie folderów działa w aplikacji Windows');if(!/^https?:\/\//.test(target))throw Error('Niepoprawny link');window.open(target,'_blank','noopener,noreferrer');},
  handoff:async()=>{const text=`Ratchet (podgląd) — agenci:\n${state().agents.map(a=>`${a.title}: ${a.status} ${a.note}`).join('\n')}`;await navigator.clipboard.writeText(text);return text;},
  refreshGithub:async()=>({github:null,githubError:'GitHub jest obsługiwany w aplikacji Windows.'}),
  checkUpdate:async()=>({available:false,version:'0.2.5',current:'0.2.5'}),
  installUpdate:async()=>toast('Aktualizator działa w aplikacji Windows'),
  hidePanel:async()=>toast('Podgląd: ukrywanie działa w aplikacji Windows'),
  quit:async()=>toast('Podgląd: wyłączanie działa w aplikacji Windows'),
  resetOrb:async()=>toast('Pozycja kuleczki działa w aplikacji Windows')
};
function updateClock(){const d=now();$('#clock').textContent=`${pad(d.getHours())}:${pad(d.getMinutes())}`;$('#dateLabel').textContent=formatDate(d);}
function health(){
  const agents=state().agents;
  const running=agents.filter(x=>x.status==='working').length;
  const attention=agents.filter(x=>x.status==='needs_attention'||x.status==='blocked').length;
  const failed=(snapshot.github?.runs||[]).some(x=>x.status==='completed'&&['failure','timed_out'].includes(x.conclusion));
  const overlaps=(snapshot.github?.overlapping||[]).length;
  return {running,attention,failed,overlaps};
}
function renderStrip(){const h=health();$('#statusStrip').innerHTML=`<div class="status-box"><span class="s-dot blue"></span><strong>${h.running}</strong> pracuje</div><div class="status-box"><span class="s-dot ${h.attention?'amber':'green'}"></span><strong>${h.attention}</strong> uwagi</div><div class="status-box"><span class="s-dot ${h.failed?'red':h.overlaps?'amber':'violet'}"></span><strong>${h.failed?'Błąd CI':h.overlaps?`${h.overlaps} ryzyk`:'GitHub'}</strong></div>`;}
function sectionHeader(title,subtitle,button=''){return `<div class="section-header"><div><h1>${title}</h1>${subtitle?`<p class="sub">${subtitle}</p>`:''}</div>${button}</div>`;}
function empty(title,desc,emoji='✦'){return `<div class="empty"><div class="empty-emoji">${emoji}</div><strong>${title}</strong><p>${desc}</p></div>`;}
function taskActions(t){return `<div class="task-actions"><button class="btn small" data-action="schedule-start" data-id="${esc(t.id)}">${I('play')} Działam${t.target?' · otwórz':''}</button><button class="btn ghost small" data-action="schedule-snooze" data-id="${esc(t.id)}">+10 min</button><button class="plain-icon" aria-label="Edytuj" title="Edytuj" data-action="edit" data-collection="schedule" data-id="${esc(t.id)}">${I('edit')}</button><button class="plain-icon" aria-label="Usuń" title="Usuń" data-action="remove" data-collection="schedule" data-id="${esc(t.id)}">${I('trash')}</button></div>`;}
function renderToday(){
  const tasks=todayTasks();const upcoming=tasks.find(t=>t.enabled&&+t.time.slice(0,2)*60+Number(t.time.slice(3))>=now().getHours()*60+now().getMinutes())||tasks.at(-1);
  const h=health();
  const hero=upcoming?`<section class="hero"><div class="eyebrow">${upcoming.time===`${pad(now().getHours())}:${pad(now().getMinutes())}`?'TERAZ TWOJA KOLEJ':'NASTĘPNY BLOK'}</div><h2>${esc(upcoming.title)} <span style="color:#9bc7ff">· ${esc(upcoming.time)}</span></h2><p>${esc(upcoming.note||`Ratchet przypomni Ci i pomoże od razu przejść do właściwego miejsca.`)}</p><div class="hero-actions"><button class="btn" data-action="schedule-start" data-id="${esc(upcoming.id)}">${I('play')} Działam${upcoming.target?' · otwórz':''}</button><button class="btn secondary" data-action="schedule-snooze" data-id="${esc(upcoming.id)}">Później</button></div></section>`:
  `<section class="hero"><div class="eyebrow">DZIŚ MASZ KONTROLĘ</div><h2>Mniej przełączania.<br>Więcej działania.</h2><p>Dodaj bloki dnia, przypisz im link lub folder. Ratchet przypomni Ci, gdzie masz być.</p><div class="hero-actions"><button class="btn" data-action="new" data-collection="schedule">+ Zaplanuj pierwszy blok</button></div></section>`;
  let html=hero+`<form class="quick-form" id="quickPlanForm"><input name="phrase" aria-label="Dodaj zadanie jednym zdaniem" placeholder="Np. o 12:00 spotkanie z zespołem" required><button class="btn" type="submit">+ Zapisz</button></form><p class="quick-hint">Wpisz jedno zdanie z godziną. Ratchet doda blok na dziś.</p>`+sectionHeader('Twój plan dnia',`${tasks.length} bloków na dziś`,`<button class="btn small secondary" data-action="new" data-collection="schedule">+ Dodaj</button>`);
  html += tasks.length?`<div class="timeline">${tasks.map(t=>`<article class="task-card" style="opacity:${t.enabled?1:.48}"><div class="time">${esc(t.time)}</div><div class="task-body"><div class="task-title">${esc(t.title)} ${t.project?`<span class="pill">${esc(t.project)}</span>`:''}</div><div class="task-note">${esc(t.note|| (t.target?short(t.target):'Brak przypiętego linku'))}</div>${taskActions(t)}</div></article>`).join('')}</div>`:
  `<div class="empty"><div class="empty-emoji">${I('calendar')}</div><strong>Żadnych bloków na dziś</strong><p>Wybierz przykład — otworzysz formularz z gotowymi danymi.</p><div class="templates"><button class="template" data-action="template" data-template="job">09:00 Praca</button><button class="template" data-action="template" data-template="city">10:00 City Route</button><button class="template" data-action="template" data-template="box">14:00 Box2Box</button></div></div>`;
  const recent=state().activity.slice(0,3);
  if(recent.length)html+=`<div class="group-title"><h3>Ostatnie sygnały</h3></div>${recent.map(a=>`<article class="task-card"><span class="s-dot ${a.level==='reminder'?'amber':'green'}" style="margin-top:5px"></span><div class="task-body"><div class="task-title">${esc(a.text)}</div><div class="task-note">${formatTime(a.at)}</div>${a.taskId?`<div class="inline-actions"><button class="btn small" data-action="schedule-start" data-id="${esc(a.taskId)}">Działam</button><button class="btn small ghost" data-action="schedule-snooze" data-id="${esc(a.taskId)}">+10 min</button></div>`:''}</div></article>`).join('')}`;
  html+=`<div class="group-title"><h3>Jeden klik do projektu</h3><button class="plain-icon" data-action="switch" data-tab="links" aria-label="Wszystkie skróty" title="Wszystkie skróty">${I('external')}</button></div>${renderQuickLinks(4)}`;
  if(h.attention||h.failed||h.overlaps)html+=`<div class="alert">${I('alert')} ${h.attention?'Masz agenta wymagającego uwagi. ':''}${h.failed?'Test CI na GitHubie zakończył się błędem. ':''}${h.overlaps?'PR-y mogą edytować te same pliki. ':''}<button class="btn tiny ghost" data-action="switch" data-tab="agents">Sprawdź agentów</button></div>`;
  return html;
}
function renderQuickLinks(limit){const items=state().links.slice(0,limit||100);return `<div class="link-grid">${items.map(x=>`<div class="link-card"><div class="link-top"><div class="link-symbol">${I(x.kind==='folder'?'folder':'external')}</div><button class="plain-icon" data-action="edit" data-collection="links" data-id="${esc(x.id)}" title="Edytuj">${I('edit')}</button><button class="plain-icon" data-action="remove" data-collection="links" data-id="${esc(x.id)}" title="Usuń">${I('trash')}</button></div><button class="plain-icon link-name" style="text-align:left;color:#e9f5ff;font-weight:700;font-size:12px;padding:0" data-action="open" data-kind="${esc(x.kind)}" data-target="${esc(x.target)}">${esc(x.title)} ${I('arrow')}</button><span class="link-type">${esc(x.group||'Inne')}</span></div>`).join('')}</div>`;}
const labels={working:['Pracuje','blue'],needs_attention:['Czeka na Ciebie','amber'],ready:['Zgłoszone jako gotowe','green'],blocked:['Blokada','red'],idle:['Spoczynek','violet']};
function renderAgent(a){const [label,color]=labels[a.status]||labels.idle;return `<article class="agent-card"><div class="agent-head"><span class="agent-dot ${color}" style="color:var(--${color==='blue'?'blue':color==='green'?'green':color==='amber'?'amber':color==='red'?'red':'blue'})"></span><div class="agent-main"><strong>${esc(a.title)}</strong><div class="agent-meta"><span class="tag">${esc(a.tool||'AI')}</span><span class="tag">${a.source==='hook'?'Hook · automatycznie':'Ręcznie'}</span><span>${esc(label)}</span></div></div><button class="plain-icon" data-action="edit" data-collection="agents" data-id="${esc(a.id)}" title="Edytuj">${I('edit')}</button></div><div class="agent-note">${esc(a.note||'Brak notatki o postępie')}${a.branch?`<br><span class="quiet">Gałąź: ${esc(a.branch)}</span>`:''}</div><div class="inline-actions">${a.target?`<button class="btn tiny" data-action="open" data-kind="${esc(a.kind||'url')}" data-target="${esc(a.target)}">${I('external')} Przejdź do sesji</button>`:''}<button class="btn tiny ghost" data-action="remove" data-collection="agents" data-id="${esc(a.id)}">Usuń</button><span class="progress">${a.updatedAt?formatTime(a.updatedAt):''}</span></div></article>`;}
function renderAgents(){
  const a=state().agents,gh=snapshot.github,err=snapshot.githubError;
  let html=sectionHeader('Centrum agentów','Model zakończył odpowiedź ≠ kod jest sprawdzony.',`<button class="btn small secondary" data-action="new" data-collection="agents">+ Agent</button>`);
  html+=`<div class="github-summary"><div class="github-top"><div><strong>GitHub · ${esc(state().settings.repo)}</strong><br><small>${gh?.checkedAt?`Odczyt: ${formatTime(gh.checkedAt)}`:'Bez ostatniego odczytu'}</small></div><button class="btn small secondary" data-action="github-refresh">${I('refresh')} Odśwież</button></div>`;
  if(gh)html+=`<div class="github-stats"><div class="metric"><b>${gh.prs.length}</b><span>Otwarte PR</span></div><div class="metric"><b>${gh.runs.filter(r=>r.status!=='completed').length}</b><span>CI w toku</span></div><div class="metric"><b>${gh.runs.filter(r=>r.conclusion==='failure').length}</b><span>CI błędy</span></div></div>`;
  else html+=`<p class="sub">${esc(err||'Łączenie z GitHubem...')}</p>`;
  html+='</div>';
  if(err)html+=`<div class="alert danger">${I('alert')} ${esc(err)}. Publiczne repozytoria są odczytywane bez tokena; prywatne nie są dostępne w tej wersji.</div>`;
  if(gh?.overlapping?.length)html+=gh.overlapping.map(x=>`<div class="alert">${I('alert')} PR #${x.a} i #${x.b} dotykają tych samych plików: <strong>${esc(x.files.join(', '))}</strong>. To ostrzeżenie o nakładaniu zmian, nie potwierdzony konflikt merge.</div>`).join('');
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
  <p class="hint">Zainstalowana wersja: <strong>0.2.5</strong>. Kolejne wersje instaluj z tego panelu — bez rozpakowywania kolejnych ZIP-ów.</p>
  ${available?`<p class="update-ready">Dostępna wersja ${esc(updateInfo.version)}: ${esc(updateInfo.notes)}</p><button class="btn full" type="button" data-action="update-install">${I('download')} Zainstaluj ${esc(updateInfo.version)}</button>`:
  `<button class="btn secondary full" type="button" data-action="update-check">${I('refresh')} Sprawdź aktualizacje</button>`}
  <p class="hint">Kanał GitHub jest prywatny. Działa przez GitHub CLI po jednorazowym zalogowaniu (gh auth login). Nowe pliki są weryfikowane SHA-256. Brak zalogowania nie wpływa na pozostałe funkcje Ratcheta.</p></div>`;
}
function renderSettings(){const s=state().settings;return sectionHeader('Ustawienia','Ratchet mieszka na Twoim komputerze.')+`<form id="settingsForm"><div class="settings-group"><h3>Monitorowany projekt GitHub</h3><div class="field"><label for="repo">Repozytorium (właściciel/nazwa)</label><input id="repo" name="repo" value="${esc(s.repo)}" placeholder="Zyczinho/city-route-app" required></div><p class="hint">Publiczne repozytorium. Odświeżanie co 10 minut; ręczne również dostępne.</p></div><div class="settings-group"><h3>Wygląd Ratcheta</h3><div class="field"><label for="avatarSize">Rozmiar kuleczki na ekranie</label><select id="avatarSize" name="avatarSize"><option value="72" ${Number(s.avatarSize||84)===72?'selected':''}>Mały — 72 px</option><option value="84" ${Number(s.avatarSize||84)===84?'selected':''}>Kompaktowy — 84 px (domyślny)</option><option value="100" ${Number(s.avatarSize||84)===100?'selected':''}>Większy — 100 px</option><option value="112" ${Number(s.avatarSize||84)===112?'selected':''}>Klasyczny — 112 px</option></select></div><p class="hint">Po zapisaniu kuleczka zmieni rozmiar w ciągu kilku sekund, bez ponownego uruchamiania Ratcheta. W kolejnych wersjach pojawią się różne buźki, kolory i animacje.</p></div><div class="settings-group"><h3>Zachowanie</h3><label class="checkbox-row"><input type="checkbox" name="notifications" ${s.notifications?'checked':''}> Powiadomienia systemowe</label><label class="checkbox-row"><input type="checkbox" name="alwaysOnTop" ${s.alwaysOnTop?'checked':''}> Kuleczka zawsze na wierzchu</label><label class="checkbox-row"><input type="checkbox" name="autoStart" ${s.autoStart?'checked':''}> Uruchamiaj Ratchet wraz z Windows</label><button type="button" class="btn secondary small" data-action="reset-orb">Przenieś kuleczkę na ekran główny</button></div><button class="btn full" type="submit">Zapisz ustawienia</button></form>${renderUpdates()}<div class="group-title"><h3>O integracjach</h3></div><div class="settings-group"><div class="keyvalue"><strong>GitHub</strong><span>API · odczyt</span></div><div class="keyvalue"><strong>Claude Code</strong><span>Hook na 127.0.0.1:47822</span></div><div class="keyvalue"><strong>ChatGPT / Claude Web</strong><span>Skróty + ręczne statusy</span></div><div class="keyvalue"><strong>Zadania</strong><span>Plik lokalny JSON</span></div><div class="separator"></div><p class="hint">Dane zapisują się w profilu Windows użytkownika Ratchet. Bez synchronizacji chmurowej. Ratchet nie wysyła automatycznie promptów i nie scala kodu.</p></div><div class="settings-exit"><h3>Zamknij aplikację</h3><p>Wyłącza kuleczkę i lokalny serwer. Twoje zadania oraz skróty pozostaną zapisane.</p><button class="btn danger" type="button" data-action="quit">${I('power')} Zakończ Ratchet</button></div>${DEMO?`<div class="alert">Tryb podglądu przeglądarkowego. Aby używać kuleczki, powiadomień systemowych i folderów, uruchom aplikację Windows.</div>`:''}`;}
function render(){updateClock();renderStrip();document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));$('#view').innerHTML=tab==='today'?renderToday():tab==='agents'?renderAgents():tab==='links'?renderLinks():renderSettings();window.ratchetHydrateIcons?.(document);}
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
    fields+=`<div class="form-grid">${input('time','Godzina',item.time||'09:00','type="time" required')}${input('project','Projekt',item.project,'placeholder="Np. City Route"')}</div>`;
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
  if(col==='schedule'){
    item.days=data.getAll('days').map(Number);
    if(data.get('repeat')==='once')item.date=data.get('date');else item.date=null;
    if(!item.date&&!item.days.length)throw Error('Wybierz co najmniej jeden dzień');
    item.enabled=data.get('enabled')==='on';
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
  if(act==='template')showModal('schedule','',templateMap[el.dataset.template]);
  if(act==='switch'){tab=el.dataset.tab;render();}
  if(act==='edit')showModal(col,id);
  if(act==='modal-close')$('#modal').hidden=true;
  if(act==='remove') {
    const item=state()[col].find(x=>x.id===id);
    if(!confirm(`Usunąć: ${item?.title||'element'}?`))return;
    await bridge.remove(col,id);if(!DEMO)snapshot=await bridge.snapshot();render();toast('Usunięto');
  }
  if(act==='schedule-start'||act==='schedule-snooze'){
    await bridge.scheduleAction(id,act==='schedule-start'?'start':'snooze');
    if(!DEMO)snapshot=await bridge.snapshot();render();toast(act==='schedule-start'?'Działamy! ✦':'Przypomnę za 10 minut');
  }
  if(act==='open'){await bridge.open(el.dataset.kind,el.dataset.target);toast('Otwieram ↗');}
  if(act==='github-refresh'){toast('Sprawdzam GitHub…');const result=await bridge.refreshGithub();snapshot={...snapshot,...result};render();if(result.githubError)toast(result.githubError);else toast('GitHub zaktualizowany');}
  if(act==='handoff'){await bridge.handoff();toast('Handoff skopiowany do schowka ✓');}
  if(act==='update-check'){
    tab='settings';render();toast('Sprawdzam kanał aktualizacji…');
    updateInfo=await bridge.checkUpdate();
    render();toast(updateInfo.available?'Dostępna aktualizacja '+updateInfo.version:'Masz aktualną wersję ✓');
  }
  if(act==='update-install'){
    if(!confirm('Zainstalować Ratchet '+updateInfo.version+'? Aplikacja uruchomi się ponownie, a Twoje zadania pozostaną zapisane.'))return;
    toast('Pobieram i weryfikuję aktualizację…');
    await bridge.installUpdate();
    toast('Ratchet uruchomi się ponownie.');
  }
  if(act==='reset-orb'){await bridge.resetOrb();toast('Kuleczka wróciła na ekran główny');}
  if(act==='show-settings'){tab='settings';render();$('#appMenu').hidden=true;$('#appMenuToggle').setAttribute('aria-expanded','false');}
  if(act==='hide-panel'){$('#appMenu').hidden=true;await bridge.hidePanel();}
  if(act==='quit'){
    if(!confirm('Zakończyć Ratchet? Kuleczka i przypomnienia przestaną działać do ponownego uruchomienia.'))return;
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
  if(tabButton){tab=tabButton.dataset.tab;render();return;}
  const a=e.target.closest('[data-action]');if(a)safe(()=>handleAction(a));
});
document.addEventListener('submit',e=>{
  if(e.target.id==='itemForm'){e.preventDefault();safe(()=>saveForm(e.target));}
  if(e.target.id==='quickPlanForm'){e.preventDefault();safe(async()=>{const raw=String(new FormData(e.target).get('phrase')||'');const match=raw.match(/(?:^|\s)(?:o\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?(?=\s|$)/i);if(!match)throw Error('Dodaj godzinę, np. o 12:00 spotkanie');const hh=pad(Number(match[1])),mm=match[2]||'00';const title=raw.replace(match[0],' ').replace(/\b(dzisiaj|jutro)\b/ig,'').replace(/^\s*[-–:,]\s*/,'').trim();if(!title)throw Error('Napisz też, co masz zrobić');const d=now();if(/\bjutro\b/i.test(raw))d.setDate(d.getDate()+1);const l=title.toLowerCase();let target='';if(/city\s*route|cityroad|city\s*road/i.test(l))target='https://github.com/Zyczinho/city-route-app';else if(/box\s*2\s*box|box2box|box\s*to\s*box/i.test(l))target='https://box2box.com.pl';else if(/szuk.*prac|ofert.*prac/i.test(l))target='https://chatgpt.com/';const url=title.match(/https?:\/\/[^\s]+/i);if(url)target=url[0];await bridge.save('schedule',{title,time:`${hh}:${mm}`,date:dateKey(d),days:[d.getDay()],target,kind:'url',enabled:true});if(!DEMO)snapshot=await bridge.snapshot();e.target.reset();render();toast('Dodano do planu ✓');});}
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
