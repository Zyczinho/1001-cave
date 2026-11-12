'use strict';
// "Podsumuj dzień": goal -> done -> result per project, from facts only.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {recordTopic,normalizeDayLog,parseRegister,buildDayReview,reviewText}=require('../day-review.cjs');

const now=Date.parse('2026-11-12T20:00:00Z');
const T=h=>new Date(Date.parse('2026-11-12T08:00:00Z')+h*3600e3).toISOString();
const date=require('../day-review.cjs').dayOf(T(0));

test('topics: one per day, tool, project and title; older than 7 days drop',()=>{
  let log=recordTopic([],{at:T(0),src:'claude',project:'1001-cave',topic:'Ratchet duplikaty',target:'C:\\a'},now);
  log=recordTopic(log,{at:T(1),src:'claude',project:'1001-CAVE',topic:'Ratchet duplikaty',target:'C:\\b'},now);
  assert.equal(log.length,1);assert.equal(log[0].target,'C:\\b');
  log=recordTopic(log,{at:'2026-11-01T10:00:00Z',src:'chatgpt',project:'x',topic:'stare'},now);
  log=recordTopic(log,{at:T(2),src:'claude',project:'p',topic:''},now);
  assert.deepEqual(log.map(e=>e.topic),['Ratchet duplikaty'],'too old and empty topics are not kept');
  assert.deepEqual(normalizeDayLog([{date:'zly',src:'claude',project:'a',topic:'b'},...log]).length,1);
});

test('register rows of one day: project, what, state and link',()=>{
  const text=['| data | projekt | skill | co | stan |','| 2026-11-12 | Rachet | wydanie | strażnik e2e | WDROŻONE | ~3 min | brak | https://github.com/Zyczinho/1001-cave/pull/39 |','| 2026-11-11 | Rachet | wydanie | stare | WDROŻONE | | | x |'].join('\n');
  assert.deepEqual(parseRegister(text,'2026-11-12'),[{project:'Rachet',skill:'wydanie',what:'strażnik e2e',state:'WDROŻONE',link:'https://github.com/Zyczinho/1001-cave/pull/39'}]);
});

test('review: goal, done, result and time per project; loose names are matched',()=>{
  const ev=(h,src,project,session,type)=>({ts:T(h),src,project,session,type});
  const review=buildDayReview({date,now,
    events:[ev(0,'claude','1001-cave','s1','prompt'),ev(0.1,'claude','1001-cave','s1','done'),ev(1,'claude','scratch-2026-11-12-ab12cd','s2','prompt'),ev(1.05,'claude','scratch-2026-11-12-ab12cd','s2','done')],
    dayLog:[{date,src:'claude',project:'1001-cave',topic:'Ratchet duplikaty',target:'C:\\x'},{date,src:'claude',project:'city-route-app',topic:'Zapis trasy e2e',target:'C:\\y'},{date:'2026-11-11',src:'claude',project:'1001-cave',topic:'wczoraj'}],
    verifications:[{row:'project:claude:city-route-app',verdict:'pass',at:T(2),summary:'Zweryfikowane: 1/1 scenariuszy e2e'}],
    register:[{project:'Rachet',what:'strażnik e2e',state:'WDROŻONE',link:'https://github.com/Zyczinho/1001-cave/pull/39'},{project:'City Route',what:'e2e',state:'SCALONE',link:''},{project:'Inny',what:'x',state:'y',link:''}],
    git:{'1001-cave':{commits:['a','b'],merged:['#39 feat: guard e2e']}}});
  const cave=review.projects.find(p=>p.name==='1001-cave');
  assert.deepEqual(cave.goals,['Ratchet duplikaty'],'only today');
  assert.deepEqual(cave.done,['Scalone: #39 feat: guard e2e','2 commity dziś']);
  assert.deepEqual(cave.results,['strażnik e2e — WDROŻONE (https://github.com/Zyczinho/1001-cave/pull/39)'],'"Rachet" matched by the repository in its link');
  assert.equal(cave.workMs,6*60000);
  const cr=review.projects.find(p=>p.name==='city-route-app');
  assert.deepEqual(cr.results,['Zweryfikowane: 1/1 scenariuszy e2e','e2e — SCALONE'],'"City Route" matched by letters');
  assert.ok(review.brief.some(p=>p.name==='bez folderu'&&p.workMs===3*60000),'old scratch names count as one place; short ones go to "Krótko"');
  assert.deepEqual(review.other,[{project:'Inny',text:'x — y'}]);
  // Plain words: the register's name, one goal, a state and one sentence, no PR numbers.
  assert.equal(cave.display,'Rachet (1001-cave)');
  assert.equal(cave.goal,'Ratchet duplikaty');
  assert.equal(cave.status,'done');
  assert.equal(cave.result,'1 zmiana scalona, 1 wdrożona.');
  assert.equal(cr.result,'Sprawdzone testem.');
  const text=reviewText(review);
  assert.match(text,/^Podsumowanie dnia 2026-11-12\n2 projekty, 1 przełączenie między nimi\./);
  assert.match(text,/Rachet \(1001-cave\) · 6 min\nCel: Ratchet duplikaty\nRezultat: osiągnięty\. 1 zmiana scalona, 1 wdrożona\./);
  assert.match(text,/Krótko: Szybkie czaty Claude\./);
  assert.match(text,/Wniosek: Dzień zamknięty/);
  assert.doesNotMatch(text,/#39|commit/,'no PR numbers or commits in the summary');
});

test('review: unknown results lead the takeaway; more goals are counted, not listed',()=>{
  const chat=(h,type)=>({ts:T(h),src:'chatgpt',project:'ChatGPT',session:'c1',type});
  const r=buildDayReview({date,now,events:[chat(0,'prompt'),chat(1/12,'work'),chat(1/6,'done')],register:[],git:{},verifications:[],
    dayLog:['A','B','C'].map(t=>({date,src:'chatgpt',project:'ChatGPT',topic:t}))});
  const p=r.projects[0];
  assert.equal(p.display,'ChatGPT (rozmowy)');
  assert.equal(p.goal,'C (+2 inne rozmowy)');
  assert.equal(p.status,'unknown');
  assert.match(r.lesson,/^Bez zmierzonego wyniku: ChatGPT \(rozmowy\)\. Rano zapisz/);
});

test('server: Claude sessions count only with a message from today, never by file date',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','server.cjs'),'utf8');
  assert.match(src,/if\(last<since\)continue;/);
  assert.match(src,/key==='day:review'/);
  assert.ok(fs.readFileSync(path.join(__dirname,'..','scripts','build-candidate.cjs'),'utf8').includes("'day-review.cjs'"),'shipped');
});
