'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=path.resolve(__dirname,'..');
const {normalizeItem,normalizeStore,defaults}=require('../core.cjs');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-calendar-'));
process.env.APPDATA=data;
const {handleAction,snapshot,read}=require('../server.cjs');

test('calendar: one-off dates and recurring weekdays remain distinct',()=>{
  const once=normalizeItem('schedule',{title:'Praca',date:'2026-11-11',days:[3],time:'08:00',endTime:'09:00'});
  const repeat=normalizeItem('schedule',{title:'Projekt',date:null,days:[1,3,5],time:'08:00',endTime:'09:00'});
  assert.equal(once.date,'2026-11-11');
  assert.equal(repeat.date,null);
  assert.deepEqual(repeat.days,[1,3,5]);
});
test('calendar: completion history validates and survives normalization',()=>{
  const item=normalizeItem('schedule',{
    title:'Szukanie pracy',date:null,days:[1,2,3,4,5],time:'08:00',endTime:'09:00',
    completedDates:['2026-11-10','2026-11-10','bad','2026-11-11']
  });
  assert.deepEqual(item.completedDates,['2026-11-10','2026-11-11']);
  const store=normalizeStore({...defaults(),schedule:[item]});
  assert.deepEqual(store.schedule[0].completedDates,item.completedDates);
});
test('calendar: pressing Finish records only todays occurrence and survives editing and signal clearing',async()=>{
  read();
  const item=await handleAction('item:save',{
    collection:'schedule',item:{id:'job',title:'Praca',time:'08:00',endTime:'09:00',date:null,days:[0,1,2,3,4,5,6],enabled:true}
  });
  const today=new Date();const key=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  assert.deepEqual(item.completedDates,[]);
  await handleAction('schedule:action',{id:'job',action:'finish'});
  assert.deepEqual(snapshot().state.schedule[0].completedDates,[key]);
  // A form edit created by an older panel omits completedDates: history must remain.
  await handleAction('item:save',{collection:'schedule',item:{id:'job',title:'Praca - edycja',time:'08:00',endTime:'09:00',date:null,days:[0,1,2,3,4,5,6]}});
  await handleAction('activity:clear',{});
  assert.deepEqual(snapshot().state.schedule[0].completedDates,[key]);
  const disk=JSON.parse(fs.readFileSync(path.join(data,'Ratchet','ratchet.json'),'utf8'));
  assert.deepEqual(disk.schedule[0].completedDates,[key]);
});
test('calendar: panel presents month, day selection and action to add on chosen date',()=>{
  const html=fs.readFileSync(path.join(root,'ui/panel.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'ui/panel.js'),'utf8');
  assert.match(html,/data-tab="calendar"/);
  assert.match(js,/function renderCalendar\(\)/);
  assert.match(js,/data-action="calendar-day"/);
  assert.match(js,/data-action="calendar-prev"/);
  assert.match(js,/data-action="calendar-next"/);
  assert.match(js,/data-action="calendar-add"/);
  assert.match(js,/function tasksOnCalendarDay\(key\)/);
});
test.after(()=>fs.rmSync(data,{recursive:true,force:true}));