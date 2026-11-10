'use strict';
const { randomUUID } = require('crypto');
const COLLECTIONS = ['schedule', 'links', 'agents'];
const STATUS = ['working', 'needs_attention', 'ready', 'blocked', 'idle'];
const VALID_WEEKDAYS = [0,1,2,3,4,5,6];
const INIT = {
  version: 1,
  settings: { repo: 'Zyczinho/city-route-app', notifications: true, autoStart: false, alwaysOnTop: true, avatarSize: 84 },
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
  if (obj.reminded && typeof obj.reminded === 'object') def.reminded = obj.reminded;
  if (Array.isArray(obj.activity)) def.activity = obj.activity.slice(0, 100);
  if (obj.orbPosition && Number.isFinite(obj.orbPosition.x) && Number.isFinite(obj.orbPosition.y)) def.orbPosition = obj.orbPosition;
  return def;
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
    return {id,title,time,endTime:endTime||null,date,days,project:cleanText(raw.project,70),target:cleanText(raw.target,2048),kind:raw.kind === 'folder' ? 'folder' : 'url', note:cleanText(raw.note,500), enabled:raw.enabled !== false, snoozeUntil:raw.snoozeUntil || null};
  }
  return {id,title,tool:cleanText(raw.tool,70)||'Inny model',status:STATUS.includes(raw.status)?raw.status:'idle',target:cleanText(raw.target,2048),kind:raw.kind === 'folder' ? 'folder' : 'url',branch:cleanText(raw.branch,120),note:cleanText(raw.note,500),source:raw.source === 'hook' ? 'hook' : 'manual',updatedAt:cleanText(raw.updatedAt,50)||new Date().toISOString()};
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
module.exports = {defaults,normalizeStore,normalizeItem,dueTasks,dueEndTasks,dayKey,validateTarget,mergeRepoData,handoffText};
