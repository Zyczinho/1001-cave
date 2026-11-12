'use strict';
// "Podsumuj dzień": goal -> what was done -> result, per project, from facts only (no AI).
// - goal: titles of today's Claude sessions and ChatGPT chats (dayLog, kept 7 days);
// - done: today's commits and merged PRs in that project's folder (read-only git);
// - result: guard verdicts and the skills register (~/.claude/skills/_rejestr/uzycia.md);
// - time: agent work time from the event log (journal.cjs daySummary).
const {daySummary} = require('./journal.cjs');

const KEEP_DAYS = 7;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const dayOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// One entry per (day, tool, project, topic); the latest folder wins. Older than 7 days drops.
function recordTopic(dayLog = [], {at = new Date().toISOString(), src, project, topic, target = ''} = {}, now = Date.now()) {
  const t = clip(topic, 120), p = clip(project, 80);
  const oldest = dayOf(new Date(now - (KEEP_DAYS - 1) * 864e5).toISOString());
  const kept = (Array.isArray(dayLog) ? dayLog : []).filter(e => e && e.date >= oldest);
  if (!t || !p || !['claude', 'chatgpt'].includes(src)) return kept;
  const date = dayOf(at);
  const same = kept.find(e => e.date === date && e.src === src && e.project.toLowerCase() === p.toLowerCase() && e.topic === t);
  if (same) { same.lastAt = at; if (target) same.target = clip(target, 1000); return kept; }
  kept.push({date, src, project: p, topic: t, target: clip(target, 1000), firstAt: at, lastAt: at});
  return kept.slice(-300);
}
function normalizeDayLog(raw) {
  return (Array.isArray(raw) ? raw : []).filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && ['claude', 'chatgpt'].includes(e.src))
    .map(e => ({date: e.date, src: e.src, project: clip(e.project, 80), topic: clip(e.topic, 120), target: clip(e.target, 1000),
      firstAt: clip(e.firstAt, 40), lastAt: clip(e.lastAt, 40)})).filter(e => e.project && e.topic).slice(-300);
}

// Register rows of one day: | data | projekt | skill | co | stan | ... | link |
function parseRegister(text = '', date) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('| ' + date + ' |')) continue;
    const c = line.split('|').slice(1, -1).map(x => x.trim());
    rows.push({project: clip(c[1], 80), skill: clip(c[2], 40), what: clip(c[3], 160), state: clip(c[4], 60),
      link: /^https:\/\/\S+$/.test(c.at(-1) || '') ? c.at(-1) : ''});
  }
  return rows;
}

// git: {projectNameLowercase: {commits: [subject], merged: [subject]}} collected by the server.
function buildDayReview({date, events = [], dayLog = [], verifications = [], register = [], git = {}, now = Date.now()} = {}) {
  // Old log entries name folder-less chats "scratch-YYYY-MM-DD-xxxx": they are one place.
  const key = name => /^scratch-\d{4}-\d{2}-\d{2}-/i.test(String(name || '')) ? 'bez folderu' : String(name || '').toLowerCase();
  // Register rows name projects loosely ("Rachet", "City Route"): match by the repository in
  // their link first, then by letters only ("cityroute" ~ "city-route-app").
  const letters = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const registerProject = r => {
    const repo = /^https:\/\/github\.com\/[^/]+\/([^/]+)/.exec(r.link || '')?.[1];
    if (repo && projects.has(repo.toLowerCase())) return projects.get(repo.toLowerCase());
    const l = letters(r.project);
    return l ? [...projects.values()].find(p => letters(p.name) === l || letters(p.name).startsWith(l)) : null;
  };
  const projects = new Map();
  const get = (name, tool) => {
    const k = key(name);
    if (!projects.has(k)) projects.set(k, {name, alias: '', tools: new Set(), goals: [], done: [], results: [], workMs: 0,
      merged: 0, commits: 0, deployed: 0, verified: 0, guardOpen: 0});
    const p = projects.get(k); if (tool) p.tools.add(tool); return p;
  };
  for (const e of dayLog.filter(e => e.date === date)) {
    const p = get(key(e.project) === 'bez folderu' ? 'bez folderu' : e.project, e.src === 'claude' ? 'Claude' : 'ChatGPT');
    if (!p.goals.includes(e.topic)) p.goals.push(e.topic);
  }
  for (const [k, g] of Object.entries(git)) {
    const p = projects.get(k); if (!p) continue;
    for (const m of g.merged || []) p.done.push('Scalone: ' + m);
    const commits = (g.commits || []).length;
    p.merged += (g.merged || []).length; p.commits += commits;
    if (commits) p.done.push(`${commits} ${commits === 1 ? 'commit' : commits < 5 ? 'commity' : 'commitów'} dziś`);
  }
  // Agent time per project, from the event log.
  const byProject = new Map();
  for (const e of events) { const k = key(e.project); if (!byProject.has(k)) byProject.set(k, []); byProject.get(k).push(e); }
  for (const [k, list] of byProject) {
    const tool = list[0].src === 'claude' ? 'Claude' : 'ChatGPT';
    const p = projects.get(k) || get(k === 'bez folderu' ? 'bez folderu' : list[0].project, tool);
    p.workMs += daySummary(list, now).workMs;
  }
  // Guard verdicts: row ids look like project:claude:<name>.
  const labels = {pass: 'Zweryfikowane', block: 'Strażnik odesłał agenta', give_up: 'Strażnik: wciąż niegotowe', error: 'Nie dało się zweryfikować'};
  for (const v of verifications.filter(v => dayOf(v.at) === date).slice().reverse()) {
    const name = String(v.row || '').split(':').slice(2).join(':');
    const p = projects.get(key(name)); if (!p) continue;
    const text = labels[v.verdict] + (v.summary ? ': ' + clip(v.summary.replace(/^Zweryfikowane:\s*/, ''), 140) : '');
    if (!p.results.includes(text)) p.results.push(text);
    if (v.verdict === 'pass') p.verified++; else p.guardOpen++;
  }
  const other = [];
  for (const r of register) {
    const p = registerProject(r);
    const text = `${r.what} — ${r.state}` + (r.link ? ` (${r.link})` : '');
    if (p) {
      if (!p.results.includes(text)) { p.results.push(text); if (/WDRO|ZAAKCEPT|WYSŁAN/i.test(r.state)) p.deployed++; }
      // The register's own name for a folder ("Rachet" for 1001-cave) is what the person says.
      if (!p.alias && r.project && letters(r.project) !== letters(p.name)) p.alias = r.project;
    } else other.push({project: r.project, text});
  }
  const list = [...projects.values()].map(p => ({...p, tools: [...p.tools], ...describe(p)}))
    .filter(p => p.goals.length || p.done.length || p.results.length || p.workMs >= 60000)
    .sort((a, b) => b.workMs - a.workMs);
  const totals = daySummary(events, now);
  // Short projects (under 5 minutes, nothing measurable) are one line, not a card each.
  const main = list.filter(p => p.workMs >= 5 * 60000 || p.status !== 'unknown');
  const brief = list.filter(p => !main.includes(p));
  return {date, totals, projects: main, brief, other, overview: overview(totals), lesson: lesson(main, totals)};
}

// Plain words, no numbers of PRs or commits: a goal, a state and one sentence.
const plural = (n, one, few, many) => n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
function describe(p) {
  const display = p.name === 'bez folderu' ? 'Szybkie czaty Claude' : p.name === 'ChatGPT' ? 'ChatGPT (rozmowy)' : p.alias ? `${p.alias} (${p.name})` : p.name;
  const goal = p.goals.length ? p.goals[p.goals.length - 1] + (p.goals.length > 1 ? ` (+${p.goals.length - 1} ${plural(p.goals.length - 1, 'inna rozmowa', 'inne rozmowy', 'innych rozmów')})` : '') : 'cel nie był zapisany';
  const bits = [];
  if (p.merged) bits.push(`${p.merged} ${plural(p.merged, 'zmiana scalona', 'zmiany scalone', 'zmian scalonych')}`);
  if (p.deployed) bits.push(`${p.deployed} ${plural(p.deployed, 'wdrożona', 'wdrożone', 'wdrożonych')}`);
  if (p.verified) bits.push('sprawdzone testem');
  let status, result;
  if (p.guardOpen && !p.verified) { status = 'progress'; result = 'Sprawdzenie jeszcze nie przeszło.'; }
  else if (p.merged || p.deployed || p.verified) { status = 'done'; result = bits.join(', ').replace(/^./, c => c.toUpperCase()) + '.'; }
  else if (p.commits) { status = 'progress'; result = 'Są zmiany w kodzie, jeszcze nie scalone.'; }
  else { status = 'unknown'; result = 'Rozmowy bez zmian w kodzie: wyniku nie da się zmierzyć.'; }
  return {display, goal, status, result};
}
function overview(t) {
  return `${t.projects} ${plural(t.projects, 'projekt', 'projekty', 'projektów')}, ${t.switches} ${plural(t.switches, 'przełączenie', 'przełączenia', 'przełączeń')} między nimi. `
    + `Agenci pracowali ok. ${minutes(t.workMs)}` + (t.waitMs >= 60000 ? `, czekali na Ciebie ok. ${minutes(t.waitMs)}.` : '.');
}
// One rule-based takeaway, the most useful first.
function lesson(projects, t) {
  const unknown = projects.filter(p => p.status === 'unknown').map(p => p.display);
  if (unknown.length) return `Bez zmierzonego wyniku: ${unknown.slice(0, 3).join(', ')}. Rano zapisz przy nich, po czym poznasz, że są zrobione.`;
  const hours = t.workMs / 3600e3;
  if (t.switches >= 20 && hours > 0 && t.switches / Math.max(hours, 1) > 8) return `Dużo przełączeń (${t.switches}). Jutro spróbuj trzymać się 1–2 projektów naraz.`;
  if (t.waitMs >= 30 * 60000) return `Agenci czekali na Ciebie ok. ${minutes(t.waitMs)}: warto szybciej odpowiadać albo dawać im pełniejsze zadania.`;
  return 'Dzień zamknięty: każdy projekt ma wynik.';
}

const minutes = ms => { const m = Math.round((ms || 0) / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + m % 60 + ' min' : ''); };
// Plain text for the clipboard (a daily note, a message, a journal).
const STATE = {done: 'osiągnięty', progress: 'w toku', unknown: 'nieznany'};
function reviewText(r) {
  const lines = [`Podsumowanie dnia ${r.date}`, r.overview];
  for (const p of r.projects) {
    lines.push('', `${p.display} · ${minutes(p.workMs)}`, `Cel: ${p.goal}`, `Rezultat: ${STATE[p.status]}. ${p.result}`);
  }
  if (r.brief.length) lines.push('', 'Krótko: ' + r.brief.map(p => p.display).join(', ') + '.');
  lines.push('', 'Wniosek: ' + r.lesson);
  return lines.join('\n');
}

module.exports = {recordTopic, normalizeDayLog, parseRegister, buildDayReview, reviewText, dayOf};
