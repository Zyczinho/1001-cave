'use strict';
// E1 of FEATURE_CZAS_I_POWTORZENIA.md: a local, append-only log of agent lifecycle events.
// One JSON line per event, one file per month, next to ratchet.json. Never prompt text:
// only when, which tool, which project, which session and what kind of moment it was.
const fs = require('node:fs');
const path = require('node:path');

const TYPES = ['start', 'prompt', 'work', 'needs_you', 'done', 'error', 'end'];
const WORK_EVERY_MS = 60 * 1000; // tool calls fire constantly; one "work" a minute is enough for timing
const FILE = /^events-(\d{4})-(\d{2})\.jsonl$/;
const clean = (s, n) => String(s ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, n);
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Claude Code hook event + the status Ratchet derived from it → journal type (null = skip).
function claudeType(event, status) {
  if (event === 'SessionStart') return 'start';
  if (event === 'UserPromptSubmit') return 'prompt';
  if (event === 'PreToolUse' || event === 'PostToolUse') return 'work';
  if (event === 'Stop') return 'done';
  if (event === 'StopFailure') return 'error';
  if (event === 'Notification') return status === 'needs_attention' ? 'needs_you' : null;
  if (event === 'SessionEnd') return 'end';
  return null;
}
// ChatGPT tab signal. A chat that starts working after it was not means you just sent a message.
function chatgptType(state, prevStatus) {
  if (state === 'working') return prevStatus === 'working' ? 'work' : 'prompt';
  if (state === 'done') return 'done';
  if (state === 'closed') return 'end';
  return null;
}

class Journal {
  constructor({dir, now = () => Date.now(), keepMonths = 6, enabled = true} = {}) {
    this.dir = dir; this.now = now; this.keepMonths = keepMonths; this.enabled = enabled && !!dir;
    this.lastWork = new Map();
    if (this.enabled) this.prune();
  }
  file(date) { return path.join(this.dir, `events-${monthKey(date)}.jsonl`); }
  // Returns the written entry, or null when skipped. Never throws: logging must not break alerts.
  record({src, project, session, type}) {
    if (!this.enabled || !TYPES.includes(type) || !['claude', 'chatgpt'].includes(src)) return null;
    const ts = this.now(), key = src + ':' + session;
    if (type === 'work') {
      if (ts - (this.lastWork.get(key) || 0) < WORK_EVERY_MS) return null;
      this.lastWork.set(key, ts);
    } else {
      this.lastWork.delete(key); // the next "work" after a prompt or a stop is always kept
    }
    const entry = {ts: new Date(ts).toISOString(), src, project: clean(project, 80), session: clean(session, 100), type};
    try {
      fs.mkdirSync(this.dir, {recursive: true});
      fs.appendFileSync(this.file(new Date(ts)), JSON.stringify(entry) + '\n', 'utf8');
      return entry;
    } catch (e) { console.warn('[ratchet] Dziennik:', e.message); return null; }
  }
  // Drop month files older than keepMonths so the log never grows without bound.
  prune() {
    try {
      const d = new Date(this.now()), oldest = d.getFullYear() * 12 + d.getMonth() - (this.keepMonths - 1);
      for (const name of fs.readdirSync(this.dir)) {
        const m = FILE.exec(name);
        if (m && Number(m[1]) * 12 + Number(m[2]) - 1 < oldest) fs.rmSync(path.join(this.dir, name), {force: true});
      }
    } catch { /* no folder yet */ }
  }
}

// Every entry with from <= ts < to, oldest first. Damaged lines are skipped, not fatal.
function readEvents(dir, {from, to} = {}) {
  const start = from ? Date.parse(from) : 0, end = to ? Date.parse(to) : Infinity;
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => FILE.test(n)).sort(); } catch { return []; }
  const out = [];
  for (const name of names) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line), t = Date.parse(e.ts);
        if (t >= start && t < end && TYPES.includes(e.type)) out.push(e);
      } catch { /* half-written line */ }
    }
  }
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

module.exports = {Journal, readEvents, claudeType, chatgptType, TYPES, WORK_EVERY_MS};
