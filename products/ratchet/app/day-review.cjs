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
    if (!projects.has(k)) projects.set(k, {name, tools: new Set(), goals: [], done: [], results: [], workMs: 0});
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
  }
  const other = [];
  for (const r of register) {
    const p = registerProject(r);
    const text = `${r.what} — ${r.state}` + (r.link ? ` (${r.link})` : '');
    if (p) { if (!p.results.includes(text)) p.results.push(text); } else other.push({project: r.project, text});
  }
  const list = [...projects.values()].map(p => ({...p, tools: [...p.tools]}))
    .filter(p => p.goals.length || p.done.length || p.results.length || p.workMs >= 60000)
    .sort((a, b) => b.workMs - a.workMs);
  return {date, totals: daySummary(events, now), projects: list, other};
}

const minutes = ms => { const m = Math.round((ms || 0) / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + m % 60 + ' min' : ''); };
// Plain text for the clipboard (a daily note, a message, a journal).
function reviewText(r) {
  const lines = [`Podsumowanie dnia ${r.date}`,
    `${r.totals.projects} projekty · ${r.totals.switches} przełączeń · agenci pracowali ${minutes(r.totals.workMs)} · czekali na Ciebie ${minutes(r.totals.waitMs)}`];
  for (const p of r.projects) {
    lines.push('', `${p.name} (${p.tools.join(', ') || '—'}, ${minutes(p.workMs)})`);
    lines.push('Cel: ' + (p.goals.length ? p.goals.join('; ') : 'brak zapisanego celu'));
    lines.push('Zrobione: ' + (p.done.length ? p.done.join('; ') : 'brak commitów'));
    lines.push('Rezultat: ' + (p.results.length ? p.results.join('; ') : 'niezweryfikowane'));
  }
  for (const o of r.other) lines.push('', `${o.project}: ${o.text}`);
  return lines.join('\n');
}

module.exports = {recordTopic, normalizeDayLog, parseRegister, buildDayReview, reviewText, dayOf};
