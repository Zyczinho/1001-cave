'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {agentHookOutcome}=require('../core.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

const now=Date.parse('2026-11-10T18:00:00Z');
const busy=(id,cwd,minutesAgo=1)=>({id,source:'hook',status:'working',target:cwd,updatedAt:new Date(now-minutesAgo*60000).toISOString()});

test('agent alerts: working is silent',()=>{
  for(const event of ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse']){
    const r=agentHookOutcome(event,{id:'claude:a',cwd:'C:\\dev\\city-route-app',now});
    assert.equal(r.status,'working');
    assert.equal(r.alert,null,event+' must not notify');
  }
});

test('agent alerts: done says "come look" with the project name',()=>{
  const r=agentHookOutcome('Stop',{id:'claude:a',prev:busy('claude:a','C:\\dev\\city-route-app'),cwd:'C:\\dev\\city-route-app',now});
  assert.equal(r.status,'ready');
  assert.equal(r.alert.phase,'agent-done');
  assert.match(r.alert.text,/^Gotowe: city-route-app — wejdź i zobacz\.$/);
});

test('agent alerts: one agent done while another in the same project still works stays silent',()=>{
  const agents=[busy('claude:a','C:\\dev\\city-route-app'),busy('claude:b','C:\\dev\\city-route-app\\')];
  const first=agentHookOutcome('Stop',{agents,id:'claude:a',prev:agents[0],cwd:'C:\\dev\\city-route-app',now});
  assert.equal(first.alert,null);
  // The last one to finish announces the whole project.
  const done=[{...agents[0],status:'ready'},agents[1]];
  const last=agentHookOutcome('Stop',{agents:done,id:'claude:b',prev:agents[1],cwd:'C:\\dev\\city-route-app',now});
  assert.equal(last.alert.phase,'agent-done');
});

test('agent alerts: other projects and stale sessions do not keep a project silent',()=>{
  const agents=[busy('claude:x','C:\\dev\\box2box'),busy('claude:old','C:\\dev\\city-route-app',45)];
  const r=agentHookOutcome('Stop',{agents,id:'claude:a',cwd:'C:\\dev\\city-route-app',now});
  assert.equal(r.alert.phase,'agent-done');
});

test('agent alerts: waiting for a decision or failing says "I need you" once',()=>{
  const ask=agentHookOutcome('Notification',{id:'claude:a',prev:busy('claude:a','C:\\dev\\cave'),cwd:'C:\\dev\\cave',now});
  assert.equal(ask.status,'needs_attention');
  assert.equal(ask.alert.phase,'agent-attention');
  assert.match(ask.alert.text,/^Potrzebuję Cię: cave/);
  const again=agentHookOutcome('Notification',{id:'claude:a',prev:{...busy('claude:a','C:\\dev\\cave'),status:'needs_attention'},cwd:'C:\\dev\\cave',now});
  assert.equal(again.alert,null,'repeated Notification must not repeat the alert');
  const fail=agentHookOutcome('StopFailure',{id:'claude:a',prev:busy('claude:a','C:\\dev\\cave'),cwd:'C:\\dev\\cave',now});
  assert.equal(fail.status,'blocked');
  assert.equal(fail.alert.phase,'agent-failure');
  const repeatStop=agentHookOutcome('Stop',{id:'claude:a',prev:{status:'ready'},cwd:'C:\\dev\\cave',now});
  assert.equal(repeatStop.alert,null,'repeated Stop must not repeat the alert');
});

test('agent alerts: worktrees are named and grouped by their repository',()=>{
  const {projectName}=require('../core.cjs');
  assert.equal(projectName('C:\\Users\\me\\1001-cave\\.claude\\worktrees\\ratchet-fix'),'1001-cave');
  assert.equal(projectName('C:\\dev\\city-route-app\\'),'city-route-app');
  // Two worktrees of one repository are one project: the first to finish stays silent.
  const agents=[busy('claude:b','C:\\Users\\me\\1001-cave\\.claude\\worktrees\\other')];
  const r=agentHookOutcome('Stop',{agents,id:'claude:a',cwd:'C:\\Users\\me\\1001-cave\\.claude\\worktrees\\ratchet-fix',now});
  assert.equal(r.alert,null);
  assert.match(read('server.cjs'),/const cwd=projectRoot\(/);
});

test('agent alerts: closing a session keeps an open "needs you"',()=>{
  const r=agentHookOutcome('SessionEnd',{id:'claude:a',prev:{status:'needs_attention',note:'Czeka na Twoją decyzję'},now});
  assert.equal(r.status,'needs_attention');
  assert.equal(r.alert,null);
});

test('agent alerts: server uses the rule and the orb shows both kinds with plain titles',()=>{
  assert.match(read('server.cjs'),/agentHookOutcome\(event,/);
  const orb=read('Ratchet-Kuleczka.ps1');
  assert.match(orb,/'agent-done' \{ return 'Rachet - gotowe, zobacz' \}/);
  assert.match(orb,/'agent-attention' \{ return 'Rachet - potrzebuję Cię' \}/);
});

test('panel: Today and Calendar add through one form; note sits under the link',()=>{
  const js=read('ui/panel.js');
  assert.doesNotMatch(js,/quickPlanForm/,'Today must use the same add form as Calendar');
  assert.match(js,/data-action="calendar-add" data-date="'\+dateKey\(\)\+'"/);
  const form=js.slice(js.indexOf("if(collection==='schedule'){"),js.indexOf("} else if(collection==='links'){"));
  const order=['Co robimy?','Początek','Koniec','Dzień','Otwórz jednym kliknięciem','Notatka','Więcej opcji'].map(x=>form.indexOf(x));
  assert.ok(order.every(i=>i>=0),'all fields present');
  assert.deepEqual([...order].sort((a,b)=>a-b),order,'fields in the agreed order');
  // The link decides its kind: a Windows path opens Explorer, anything else is a web page or chat.
  const src=js.match(/item\.kind=(\/.+?\/)\.test/)[1];
  const isFolder=new Function('return '+src)();
  for(const v of ['C:\\Users\\me\\Docs','c:/work','\\\\server\\share'])assert.ok(isFolder.test(v),v);
  for(const v of ['https://www.pracuj.pl','https://chatgpt.com/c/123',''])assert.ok(!isFolder.test(v),v);
});

test('panel: one "now" card, compact rows and folded extras in a 360 x 520 window',()=>{
  const js=read('ui/panel.js'),html=read('ui/panel.html');
  assert.match(js,/function renderNow\(\)/);
  assert.match(js,/function taskRow\(t,/);
  assert.match(js,/more\('coordinator','Koordynator agentów \(beta\)'/);
  assert.doesNotMatch(html,/id="clock"|id="statusStrip"|class="footer"/,'clock, counters and footer took 120 px of the window');
  assert.match(html,/<title>Rachet<\/title>/);
});
