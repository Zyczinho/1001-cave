'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {nextHint}=require('../journal.cjs');

const NOW=Date.parse('2026-11-18T15:00:00Z');
const at=min=>new Date(NOW-min*60000).toISOString();
const ev=(min,type,project='p',session='s',src='claude')=>({ts:at(min),src,project,session,type});

test('no events and no agents: no hint',()=>{
  assert.equal(nextHint({now:NOW}),null);
});
test('finished agent unopened for 15+ min comes first',()=>{
  const h=nextHint({now:NOW,agents:[{title:'City Route',status:'ready',updatedAt:at(40)}],events:[ev(5,'prompt','a'),ev(4,'prompt','b'),ev(3,'prompt','c'),ev(2,'prompt','d')]});
  assert.equal(h.id,'waiting');
  assert.match(h.title,/40 min/);
  assert.match(h.text,/City Route/);
  assert.equal(nextHint({now:NOW,agents:[{title:'x',status:'ready',updatedAt:at(5)}]}),null,'fresh result is not nagged');
  assert.equal(nextHint({now:NOW,agents:[{title:'x',status:'ready',updatedAt:at(9*60)}]}),null,'old rows fade, no nag');
  assert.match(nextHint({now:NOW,agents:[{title:'a',status:'ready',updatedAt:at(20)},{title:'b',status:'ready',updatedAt:at(50)}]}).title,/2 agentów/);
});
test('four projects prompted within an hour',()=>{
  const h=nextHint({now:NOW,events:['a','b','c','d'].map((p,i)=>ev(50-i*10,'prompt',p,p))});
  assert.equal(h.id,'tooMany');
  assert.equal(nextHint({now:NOW,events:['a','b','c'].map((p,i)=>ev(50-i*10,'prompt',p,p))}),null);
});
test('one session running all day with many prompts',()=>{
  const events=[];for(let i=0;i<40;i++)events.push(ev(7*60-i*10,'prompt'));
  // gaps of 10 min keep it continuous, so this is also "no break"; longSession wins.
  assert.equal(nextHint({now:NOW,events}).id,'longSession');
});
test('three hours of activity without a 20-minute pause',()=>{
  const events=[];for(let m=200;m>=5;m-=15)events.push(ev(m,'work','p','s'+(m%2)));
  assert.equal(nextHint({now:NOW,events}).id,'noBreak');
  const paused=events.filter(e=>{const m=(NOW-Date.parse(e.ts))/60000;return m<90||m>115;});
  assert.equal(nextHint({now:NOW,events:paused}),null,'a real pause resets the count');
});
test('panel shows the hint quietly and never over an alert',()=>{
  const js=fs.readFileSync(path.join(__dirname,'..','ui','panel.js'),'utf8');
  assert.match(js,/renderNow\(\)\+renderHint\(\)/);
  assert.match(js,/x\.attention\|\|x\.failed/);
  assert.match(js,/data-action="hint-snooze"/);
  assert.doesNotMatch(js,/agentGuide/,'the three-step coordinator tutorial is gone');
});
