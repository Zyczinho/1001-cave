'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-notifications-'));
process.env.APPDATA=dir;
const {defaults,normalizeItem}=require('../core.cjs');
const {read,checkSchedule,snapshot,handleAction}=require('../server.cjs');
test('scheduled beginning and planned end each emit one persisted Windows reminder',()=>{
  const state=defaults();
  state.schedule=[
    normalizeItem('schedule',{id:'morning',title:'Poranny blok',time:'12:00',endTime:'13:00',days:[1]}),
    normalizeItem('schedule',{id:'afternoon',title:'Popołudniowy blok',time:'13:00',endTime:'14:00',days:[1]})
  ];
  const profile=path.join(dir,'Ratchet','ratchet.json');fs.mkdirSync(path.dirname(profile),{recursive:true});
  fs.writeFileSync(profile,JSON.stringify(state),'utf8');
  read();
  const at=new Date('2026-11-09T13:01:00');
  checkSchedule(at);checkSchedule(at);
  const snap=snapshot().state;
  const all=snap.activity.filter(x=>x.level==='reminder');
  assert.equal(all.filter(x=>x.phase==='start').length,1);
  assert.equal(all.filter(x=>x.phase==='end').length,1);
  assert.match(all.find(x=>x.phase==='start').text,/Początek/);
  assert.match(all.find(x=>x.phase==='end').text,/Planowany koniec/);
  assert.equal(Object.keys(snap.reminded).length,2);
  const disk=JSON.parse(fs.readFileSync(profile,'utf8'));
  assert.equal(disk.activity.length,2);
});
test('manual completion and test notification appear in native reminder feed',async()=>{
  await handleAction('schedule:action',{id:'morning',action:'finish'});
  const ack=await handleAction('notification:test',{});
  assert.equal(ack.queued,true);
  const reminders=snapshot().state.activity.filter(x=>x.level==='reminder');
  assert.ok(reminders.some(x=>x.phase==='finished'&&/Zakończono/.test(x.text)));
  assert.ok(reminders.some(x=>x.phase==='test'&&/próbny dymek/.test(x.text)));
});
test('notification receipts distinguish queueing, bubble display and Windows attempt',async()=>{
  const event=await handleAction('notification:test',{});
  assert.equal(event.queued,true);
  assert.ok(event.id);
  const pending=await handleAction('notification:status',{id:event.id});
  assert.equal(pending.found,true);
  assert.equal(pending.delivery,null,'queuing is not display evidence');
  const delivery=await handleAction('notification:delivery',{id:event.id,bubbleShown:true,windowsAttempted:true});
  assert.equal(delivery.bubbleShown,true);
  assert.equal(delivery.windowsAttempted,true);
  const ack=await handleAction('notification:status',{id:event.id});
  assert.equal(ack.delivery.bubbleShown,true);
  assert.equal(ack.delivery.windowsAttempted,true);
  await assert.rejects(handleAction('notification:delivery',{id:'unknown',bubbleShown:true}),/Nie znaleziono/);
});
test('clearing recent signals does not delete tasks or reset reminders',async()=>{
  const event=await handleAction('notification:test',{});
  const before=snapshot().state;
  const scheduled=before.schedule.length;
  const reminderKeys=Object.keys(before.reminded).sort();
  await handleAction('activity:remove',{id:event.id});
  assert.equal(snapshot().state.activity.some(x=>x.id===event.id),false);
  const result=await handleAction('activity:clear',{});
  assert.ok(result.removed>0);
  assert.equal(snapshot().state.activity.length,0);
  assert.equal(snapshot().state.schedule.length,scheduled);
  assert.deepEqual(Object.keys(snapshot().state.reminded).sort(),reminderKeys);
  const disk=JSON.parse(fs.readFileSync(path.join(dir,'Ratchet','ratchet.json'),'utf8'));
  assert.deepEqual(disk.activity,[]);
});
test.after(()=>{fs.rmSync(dir,{force:true,recursive:true});});