'use strict';
const { randomUUID } = require('crypto');
const {normalizeCoordinator}=require('./coordinator.cjs');
const {normalizeChatGPTRuns}=require('./chatgpt-workspace.cjs');
const {normalizeSignals}=require('./chatgpt-signal.cjs');
const COLLECTIONS = ['schedule', 'links', 'agents'];
const STATUS = ['working', 'needs_attention', 'ready', 'blocked', 'idle'];
const VALID_WEEKDAYS = [0,1,2,3,4,5,6];
const INIT = {
  version: 1,
  settings: { repo: 'Zyczinho/city-route-app', notifications: true, autoStart: false, alwaysOnTop: true, avatarSize: 84, panelSize: null },
  schedule: [],
  links: [
    {id:'cityroute',title:'City Route',kind:'url',target:'https://city-route-app.jakublojek.workers.dev',group:'Projekt'},
    {id:'github',title:'City Route · GitHub',kind:'url',target:'https://github.com/Zyczinho/city-route-app',group:'Kod'},
    {id:'cave',title:'1001 CAVE',kind:'url',target:'https://github.com/Zyczinho/1001-cave',group:'Projekt'},
    {id:'box',title:'Box2Box',kind:'url',target:'https://box2box.com.pl',group:'Sklep'},
    {id:'chatgpt',title:'ChatGPT',kind:'url',target:'https://chatgpt.com/',group:'AI'},
    {id:'claude',title:'Claude',kind:'url',target:'https://claude.ai/',group:'AI'}
  ],
  agents: [],
  coordinator: {enabled:false,jobs:[]},
  chatgptRuns: [],
  chatgptSignals: [],
  reminded: {},
  activity: [],
  orbPosition: null
};
const clone = value => JSON.parse(JSON.stringify(value));
function defaults() { return clone(INIT); }
function normalizeStore(obj) {
  const def = defaults();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return def;
  for (const key of COLLECTIONS) if (Array.isArray(obj[key])) def[key] = obj[key].slice(0, 300);
  if (obj.settings && typeof obj.settings === 'object') {
    for (const key of Object.keys(def.settings)) if (key in obj.settings) def.settings[key] = obj.settings[key];
  }
  if (![48,56,64,72,84,100,112].includes(def.settings.avatarSize)) def.settings.avatarSize = 84;
  def.settings.panelSize = normalizePanelSize(def.settings.panelSize);
  if (obj.reminded && typeof obj.reminded === 'object') def.reminded = obj.reminded;
  if (Array.isArray(obj.activity)) def.activity = obj.activity.slice(0, 100);
  def.coordinator=normalizeCoordinator(obj.coordinator);
  def.chatgptRuns=normalizeChatGPTRuns(obj.chatgptRuns);
  def.chatgptSignals=normalizeSignals(obj.chatgptSignals);
  if (obj.orbPosition && Number.isFinite(obj.orbPosition.x) && Number.isFinite(obj.orbPosition.y)) def.orbPosition = obj.orbPosition;
  return def;
}
// A remembered panel size must stay a small companion, never a desktop-sized window.
function normalizePanelSize(size) {
  if (!size || typeof size !== 'object') return null;
  const w = Math.round(Number(size.w)), h = Math.round(Number(size.h));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 280 || w > 900 || h < 340 || h > 1100) return null;
  return { w, h };
}
function cleanText(input, max = 300) { return String(input ?? '').trim().slice(0, max); }
function normalizeItem(collection, raw) {
  if (!COLLECTIONS.includes(collection) || !raw || typeof raw !== 'object') throw Error('Nieprawidłowe dane');
  const id = cleanText(raw.id, 100) || randomUUID();
  const title = cleanText(raw.title, 160);
  if (!title) throw Error('Podaj nazwę');
  if (collection === 'links') {
    const kind = raw.kind === 'folder' ? 'folder' : 'url';
    const target = cleanText(raw.target, 2048);
    if (!target) throw Error('Podaj link albo ścieżkę folderu');
    return { id, title, kind, target, group: cleanText(raw.group, 60) || 'Inne' };
  }
  if (collection === 'schedule') {
    const time = cleanText(raw.time, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('Godzina musi mieć format HH:MM');
    const days = Array.isArray(raw.days) ? [...new Set(raw.days.map(Number).filter(n => VALID_WEEKDAYS.includes(n)))] : [0,1,2,3,4,5,6];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date||'')) && !Number.isNaN(Date.parse(raw.date+'T12:00:00')) ? raw.date : null;
    if (!date && !days.length) throw Error('Wybierz co najmniej jeden dzień');
    // Legacy blocks without an end remain start-only. New blocks use a visible end time.
    const endTime = cleanText(raw.endTime,5);
    if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw Error('Koniec bloku musi mieć format HH:MM');
    if (endTime && endTime <= time) throw Error('Koniec bloku musi być później niż początek (tego samego dnia)');
    // Store completion per calendar day, especially for weekly repeating blocks.
    // Kept independently of the short activity feed, so "Wyczyść sygnały" cannot erase history.
    const completedDates=Array.isArray(raw.completedDates)
      ? [...new Set(raw.completedDates.filter(x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T12:00:00'))))].sort().slice(-365)
      : [];
    return {id,title,time,endTime:endTime||null,date,days,project:cleanText(raw.project,70),target:cleanText(raw.target,2048),kind:raw.kind === 'folder' ? 'folder' : 'url', note:cleanText(raw.note,500), enabled:raw.enabled !== false, snoozeUntil:raw.snoozeUntil || null,completedDates};
  }
  return {id,title,tool:cleanText(raw.tool,70)||'Inny model',status:STATUS.includes(raw.status)?raw.status:'idle',target:cleanText(raw.target,2048),kind:raw.kind === 'folder' ? 'folder' : 'url',branch:cleanText(raw.branch,120),note:cleanText(raw.note,500),topic:cleanText(raw.topic,120),source:['hook','browser'].includes(raw.source) ? raw.source : 'manual',updatedAt:cleanText(raw.updatedAt,50)||new Date().toISOString()};
}
function dayKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function minuteOfDay(date) { return date.getHours()*60+date.getMinutes(); }
function dueTasks(store, now = new Date()) {
  const current = minuteOfDay(now);
  return store.schedule.filter(task => {
    if (!task.enabled || (task.date ? task.date!==dayKey(now) : !task.days.includes(now.getDay()))) return false;
    const scheduled = Number(task.time.slice(0,2))*60+Number(task.time.slice(3,5));
    const minutesSince = current - scheduled;
    const snoozed = task.snoozeUntil && new Date(task.snoozeUntil).getTime();
    if (snoozed && snoozed > now.getTime()) return false;
    if (snoozed && snoozed <= now.getTime() && snoozed > now.getTime()-60000) return true;
    return minutesSince >= 0 && minutesSince <= 20;
  }).filter(task => !store.reminded[`${dayKey(now)}:${task.id}:${task.snoozeUntil||'base'}`]);
}
// End reminders reflect the *planned* end; actual completion requires a user action.
function dueEndTasks(store, now = new Date()) {
  const current = minuteOfDay(now);
  const date = dayKey(now);
  return store.schedule.filter(task=>{
    if(!task.enabled || !task.endTime ||
       (task.date ? task.date!==date : !task.days.includes(now.getDay()))) return false;
    const planned = Number(task.endTime.slice(0,2))*60+Number(task.endTime.slice(3,5));
    return current>=planned && current-planned<=20 &&
      !store.reminded[`${date}:${task.id}:end`];
  });
}
function validateTarget(kind, target) {
  const value = cleanText(target,2048);
  if (kind === 'folder') {
    if (!value || /^[\x00-\x1f]/.test(value)) throw Error('Nieprawidłowa ścieżka');
    return value;
  }
  let url;
  try { url = new URL(value); } catch { throw Error('Nieprawidłowy adres URL'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw Error('Dozwolone są tylko linki HTTP/HTTPS');
  return url.href;
}
function mergeRepoData(pulls, runs, filesByPr = {}) {
  const prs = (pulls || []).slice(0,30).map(pr => ({number:pr.number,title:pr.title,html_url:pr.html_url,head_sha:pr.head?.sha||'',branch:pr.head?.ref||'',draft:!!pr.draft,mergeable:pr.mergeable,updated_at:pr.updated_at}));
  const prHeads=new Set(prs.map(p=>p.head_sha));
  const seenRuns=new Set();
  const runItems = (runs||[]).filter(r=>['main','master'].includes(r.head_branch)||prHeads.has(r.head_sha)).sort((a,b)=>Date.parse(b.created_at||b.updated_at||0)-Date.parse(a.created_at||a.updated_at||0)).filter(r=>{
    const key=`${r.name||r.workflow_id}:${r.head_branch||r.head_sha}`;
    if(seenRuns.has(key))return false;
    seenRuns.add(key);return true;
  }).slice(0,15).map(run=>({name:run.name,conclusion:run.conclusion,status:run.status,html_url:run.html_url,head_sha:run.head_sha,head_branch:run.head_branch,updated_at:run.updated_at}));
  const overlapping=[];
  for(let i=0;i<prs.length;i++) for(let j=i+1;j<prs.length;j++) {
    const a=filesByPr[prs[i].number], b=filesByPr[prs[j].number];
    if(!Array.isArray(a)||!Array.isArray(b)) continue;
    const hit = a.filter(f=>b.includes(f));
    if(hit.length) overlapping.push({a:prs[i].number,b:prs[j].number,files:hit.slice(0,6)});
  }
  return {prs,runs:runItems,overlapping,checkedAt:new Date().toISOString()};
}
function handoffText(state, github) {
  const lines = [
    'RATCHET — KONTEKST PRZEKAZANIA ZADANIA',
    `Data: ${new Date().toLocaleString('pl-PL')}`,
    `Repozytorium: ${state.settings.repo||'brak'}`,
    '', 'SESJE AGENTÓW (statusy ręczne lub hooki — nie stanowią dowodu testów):'
  ];
  for (const a of state.agents) lines.push(`- ${a.title} [${a.tool}]: ${a.status}; gałąź: ${a.branch||'-'}; ${a.note||''}`);
  if (!state.agents.length) lines.push('- Brak dodanych agentów');
  lines.push('', 'GITHUB (ostatni odczyt):');
  if(github?.prs) {
    for(const pr of github.prs) lines.push(`- PR #${pr.number} ${pr.title} (${pr.branch}) ${pr.html_url}`);
    if (!github.prs.length) lines.push('- Brak otwartych PR-ów');
    for(const overlap of github.overlapping||[]) lines.push(`- RYZYKO NAKŁADANIA: PR #${overlap.a} i #${overlap.b} zmieniają: ${overlap.files.join(', ')}`);
    for(const run of github.runs.slice(0,8)) lines.push(`- CI ${run.name}: ${run.status}/${run.conclusion||'w toku'} ${run.html_url}`);
  } else lines.push('- Dane GitHuba niezaładowane — zweryfikuj samodzielnie');
  lines.push('', 'POLECENIE:', 'Przed zmianą kodu sprawdź aktualny main, PR-y, zmieniane pliki i testy. Nie zakładaj, że odpowiedź agenta oznacza wdrożenie. Pracuj na osobnej gałęzi/worktree. Przy nakładaniu się plików uzgodnij kolejność merge. Po zmianie podaj commit, testy i status PR.');
  return lines.join('\n');
}
// Claude Code hook event -> agent status and at most one human alert.
// Rules the owner asked for: stay silent while work continues, say "done, come look"
// only when nothing else in the same project is still working, and say "I need you"
// at once when an agent waits for a decision or fails.
const BUSY_WINDOW_MS = 30 * 60 * 1000;
// The person thinks in projects, not folders: a Claude Code worktree
// (<repo>\.claude\worktrees\<name>) belongs to <repo>. The server passes the git root
// (see projectRoot in server.cjs), so a subfolder like "app" is never the name.
// Claude chats started without a folder live in throwaway "scratch" folders, one per
// chat. They are not projects, so they share one row instead of one row per chat.
const SCRATCH_NAME = 'bez folderu';
function projectName(cwd) {
  const parts = String(cwd || '').split(/[\\/]+/).filter(Boolean);
  if (parts.some(p => p.toLowerCase() === 'scratch-workspaces') || /^scratch-\d{4}-\d{2}-\d{2}-/i.test(parts[parts.length - 1] || '')) return SCRATCH_NAME;
  const w = parts.findIndex((p, i) => p.toLowerCase() === '.claude' && String(parts[i + 1] || '').toLowerCase() === 'worktrees');
  if (w > 0) return parts[w - 1];
  return parts.length ? parts[parts.length - 1] : '';
}
function sameProject(a, b) {
  const x = projectName(a).toLowerCase();
  return !!x && x === projectName(b).toLowerCase();
}
// Claude Code sends Notification for several reasons. Only a permission prompt or a
// question (elicitation) needs the person. "idle_prompt" just means a finished session
// has waited a minute for the next message, and "auth_success" is informational:
// neither is a task, so neither may say "Potrzebuję Cię".
const QUIET_NOTIFICATIONS = new Set(['idle_prompt', 'auth_success']);
function needsPerson(notificationType = '', message = '') {
  if (QUIET_NOTIFICATIONS.has(notificationType)) return false;
  if (notificationType) return true;
  // Older Claude Code versions send no type; the idle message is recognisable.
  return !/waiting for your input/i.test(message);
}
function agentHookOutcome(event, {agents = [], id = '', prev = null, cwd = '', now = Date.now(), notificationType = '', message = ''} = {}) {
  if (event === 'Notification' && !needsPerson(notificationType, message)) {
    // Keep whatever the session already was (normally "ready" after Stop) and stay silent.
    const kept = prev?.status && prev.status !== 'working' ? prev.status : 'ready';
    return {status: kept, note: prev?.note && kept === prev.status ? prev.note : 'Skończył — wejdź i zobacz', alert: null};
  }
  const status = event === 'StopFailure' ? 'blocked'
    : event === 'Notification' ? 'needs_attention'
    : event === 'Stop' ? 'ready'
    : event === 'SessionEnd' ? (prev?.status === 'needs_attention' || prev?.status === 'blocked' ? prev.status : 'idle')
    : 'working';
  const note = event === 'Stop' ? 'Skończył — wejdź i zobacz'
    : event === 'Notification' ? 'Czeka na Twoją decyzję'
    : event === 'StopFailure' ? 'Błąd — sprawdź sesję'
    : event === 'SessionEnd' ? (prev?.note || 'Sesja zamknięta')
    : 'Pracuje';
  const label = projectName(cwd) || prev?.title || 'Claude Code';
  let alert = null;
  const changed = prev?.status !== status;
  if (event === 'Notification' && changed) {
    alert = {phase: 'agent-attention', text: 'Potrzebuję Cię: ' + label + ' — agent czeka na Twoją decyzję.'};
  } else if (event === 'StopFailure' && changed) {
    alert = {phase: 'agent-failure', text: 'Potrzebuję Cię: ' + label + ' — agent zgłosił błąd.'};
  } else if (event === 'Stop' && changed) {
    const othersBusy = agents.some(a => a.id !== id && a.source === 'hook' && a.status === 'working'
      && sameProject(a.target, cwd) && now - Date.parse(a.updatedAt || 0) < BUSY_WINDOW_MS);
    if (!othersBusy) alert = {phase: 'agent-done', text: 'Gotowe: ' + label + ' — wejdź i zobacz.'};
  }
  return {status, note, alert};
}
// ChatGPT in the browser, reported by the Rachet Edge extension. Only conversation
// URLs on chatgpt.com are accepted; a ChatGPT project URL gives the project name.
// ChatGPT sometimes drops the name from a project address (g-p-<id>/c/...). The id is
// what identifies the project; the name is only known from addresses that carry it.
const CHATGPT_CHAT = /^https:\/\/chatgpt\.com\/(?:g\/g-p-([0-9a-f]{32})(?:-([A-Za-z0-9-]{1,80}))?\/)?c\/([A-Za-z0-9-]{8,80})$/;
function parseChatUrl(url) {
  const m = CHATGPT_CHAT.exec(String(url || ''));
  return m ? {url: m[0], project: m[2] || '', projectId: m[1] || '', conversation: m[3]} : null;
}
// The project name for a chat address, borrowed from any known address of the same
// project when this one has no name, so one project never becomes two rows.
function chatProjectName(url, knownTargets = []) {
  const chat = parseChatUrl(url);
  if (!chat) return '';
  if (chat.project || !chat.projectId) return chat.project;
  for (const t of knownTargets) {
    const other = parseChatUrl(t);
    if (other?.projectId === chat.projectId && other.project) return other.project;
  }
  return '';
}
const MIN_ANSWER_MS = 15000;
function browserChatOutcome(signal = {}, {agents = [], now = Date.now(), project = ''} = {}) {
  const chat = parseChatUrl(signal.url);
  if (!chat) throw Error('Nieobsługiwany adres rozmowy ChatGPT');
  const state = ['working', 'done', 'closed'].includes(signal.state) ? signal.state : null;
  if (!state) throw Error('Nieznany stan rozmowy');
  const id = 'chatgpt:' + chat.conversation;
  const prev = agents.find(a => a.id === id) || null;
  const chatTitle = String(signal.title || '').replace(/\s*[|–-]\s*ChatGPT\s*$/i, '').replace(/^ChatGPT$/i, '').trim().slice(0, 80);
  const projectLabel = chat.project || project;
  const label = projectLabel || chatTitle || 'ChatGPT';
  const title = (projectLabel && chatTitle ? projectLabel + ' · ' + chatTitle : label).slice(0, 120);
  const status = state === 'working' ? 'working' : state === 'done' ? 'ready' : (prev?.status === 'working' ? 'idle' : prev?.status || 'idle');
  const note = state === 'working' ? 'Pracuje' : state === 'done' ? 'Skończył — wejdź i zobacz' : prev?.note || 'Karta zamknięta';
  let alert = null;
  const duration = Number(signal.durationMs) || 0;
  // Silent when you are looking at that tab or the answer was quick; silent while
  // another chat of the same ChatGPT project is still working.
  if (state === 'done' && prev?.status === 'working' && signal.visible !== true && duration >= MIN_ANSWER_MS) {
    const othersBusy = chat.projectId && agents.some(a => a.id !== id && a.source === 'browser' && a.status === 'working'
      && parseChatUrl(a.target)?.projectId === chat.projectId && sessionLive(a, now));
    if (!othersBusy) alert = {phase: 'chatgpt-done', text: 'Gotowe: ' + label + ' — wejdź i zobacz.'};
  }
  return {id, url: chat.url, title, topic: chatTitle, status, note, alert};
}
// A ChatGPT row's note holds "project · chat title" (or just the chat title for chats
// outside a project). The chat title is the topic; the project name alone is not.
function topicFromNote(note = '', place = '') {
  const text = String(note || '').trim();
  const at = text.indexOf(' · ');
  if (at >= 0) return text.slice(at + 3).trim();
  return text && !['chatgpt', String(place).toLowerCase()].includes(text.toLowerCase()) ? text : '';
}
// The topic of a Claude session is the title Claude gives it (the name in the Claude
// app's session list). Claude writes it into the session file again and again, so the
// last one in a chunk of the file is the current name.
function transcriptTitle(text = '') {
  let title = '';
  const re = /"type":"(?:custom-title|ai-title)","(?:customTitle|aiTitle)":"((?:[^"\\]|\\.){1,400})"/g;
  for (let m; (m = re.exec(String(text)));) {
    try { title = JSON.parse('"' + m[1] + '"'); } catch {}
  }
  return title.replace(/\s+/g, ' ').trim().slice(0, 120);
}
// The panel shows one row per project, not one per conversation or session.
// A row "works" while any of its sessions works; a browser session that stops
// confirming (closed tab, lost signal) stops counting after 3 minutes.
const STALE_MS = {browser: 3 * 60 * 1000, hook: BUSY_WINDOW_MS};
// An unanswered "needs you" fades after 8 hours: by then the session is gone or the
// person has moved on, and a permanent orange row only teaches them to ignore it.
const ATTENTION_MS = 8 * 3600 * 1000;
function sessionLive(s, now = Date.now()) {
  const age = now - Date.parse(s.updatedAt || 0);
  if (s.status === 'working') return age < (STALE_MS[s.source] || BUSY_WINDOW_MS);
  if (s.status === 'needs_attention' || s.status === 'blocked') return age < ATTENTION_MS;
  return true;
}
function rowStatus(sessions = [], now = Date.now()) {
  const live = sessions.map(s => sessionLive(s, now) ? s.status : 'idle');
  for (const status of ['blocked', 'needs_attention', 'working', 'ready']) if (live.includes(status)) return status;
  return 'idle';
}
function rowKey(source, name) {
  return 'project:' + source + ':' + String(name || '').toLowerCase().slice(0, 80);
}
// Rows Rachet made itself are tidied on start and once a minute:
// - every scratch-chat row from older versions becomes the one shared row;
// - a ChatGPT row saved under a chat title, because the address lacked the project
//   name, goes when the same project already has its named row;
// - a row resting for over 3 days disappears; it comes back the moment work resumes.
const REST_MS = 3 * 24 * 3600 * 1000;
function tidyAgentRows(agents = [], now = Date.now()) {
  const auto = a => String(a.id || '').startsWith('project:') && ['hook', 'browser'].includes(a.source);
  const time = a => Date.parse(a.updatedAt || 0) || 0;
  const resting = a => a.status === 'idle' && now - time(a) > REST_MS;
  const scratch = agents.filter(a => auto(a) && a.source === 'hook' && projectName(a.target) === SCRATCH_NAME);
  const named = new Set(agents.filter(a => auto(a) && a.source === 'browser' && parseChatUrl(a.target)?.project)
    .map(a => parseChatUrl(a.target).projectId));
  const out = agents.filter(a => {
    if (!auto(a)) return true;
    if (scratch.includes(a)) return false;
    const chat = a.source === 'browser' ? parseChatUrl(a.target) : null;
    if (chat?.projectId && !chat.project && named.has(chat.projectId)) return false;
    return !resting(a);
  });
  if (scratch.length) {
    const newest = scratch.reduce((x, y) => time(y) > time(x) ? y : x);
    const merged = {...newest, id: rowKey('claude', SCRATCH_NAME), title: SCRATCH_NAME};
    if (!resting(merged)) out.unshift(merged);
  }
  return out;
}
// "Show this chat" for the browser extension. The extension keeps one request open
// (a long poll); a click answers it at once, so the extension can bring the tab that
// already holds the conversation to the front instead of Rachet opening a new one.
class BrowserFocus {
  constructor({now = Date.now, holdMs = 20000, freshMs = 5000} = {}) {
    this.now = now; this.holdMs = holdMs; this.freshMs = freshMs;
    this.waiters = []; this.pending = null; this.lastPoll = -Infinity;
  }
  // The extension is waiting right now, or was a moment ago (it is between two polls).
  connected() { return this.waiters.length > 0 || this.now() - this.lastPoll < this.freshMs; }
  // False means no extension is listening: the caller opens the address itself.
  request(url) {
    if (!this.connected()) return false;
    const waiter = this.waiters[0];
    if (waiter) waiter(url); else this.pending = {url, at: this.now()};
    return true;
  }
  // Resolves with a chat address to show, or '' when nothing was asked in holdMs.
  wait() {
    this.lastPoll = this.now();
    const pending = this.pending; this.pending = null;
    if (pending && this.now() - pending.at < this.freshMs) return Object.assign(Promise.resolve(pending.url), {cancel() {}});
    let finish;
    const promise = new Promise(resolve => {
      const timer = setTimeout(() => finish(''), this.holdMs);
      timer.unref?.();
      finish = (url, gone = false) => {
        const at = this.waiters.indexOf(finish);
        if (at < 0) return;
        this.waiters.splice(at, 1); clearTimeout(timer);
        if (!gone) this.lastPoll = this.now();
        resolve(url);
      };
      this.waiters.push(finish);
    });
    // The browser closed the request: this waiter no longer counts as a listener.
    return Object.assign(promise, {cancel: () => finish('', true)});
  }
}
module.exports = {BrowserFocus,defaults,normalizeStore,normalizePanelSize,normalizeItem,dueTasks,dueEndTasks,dayKey,validateTarget,mergeRepoData,handoffText,agentHookOutcome,projectName,parseChatUrl,chatProjectName,tidyAgentRows,transcriptTitle,topicFromNote,browserChatOutcome,sessionLive,rowStatus,rowKey,STALE_MS};
