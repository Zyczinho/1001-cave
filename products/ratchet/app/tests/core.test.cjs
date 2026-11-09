'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {defaults,normalizeStore,normalizeItem,validateTarget,dayKey,dueTasks,mergeRepoData,handoffText}=require('../core.cjs');
test('default settings and links exist, no fake schedule',()=>{const s=defaults();assert.equal(s.settings.repo,'Zyczinho/city-route-app');assert.equal(s.schedule.length,0);assert.equal(s.agents.length,0);assert(s.links.length>0);});
test('normalize schedule and validate date',()=>{const t=normalizeItem('schedule',{title:'Spotkanie',time:'12:00',days:[1,1,2,8],kind:'url',target:'https://meet.google.com/abc'});assert.deepEqual(t.days,[1,2]);assert.throws(()=>normalizeItem('schedule',{title:'X',time:'25:99'}));});
test('reject unsafe URLs',()=>{assert.throws(()=>validateTarget('url','file:///etc/passwd'));assert.throws(()=>validateTarget('url','javascript:alert(1)'));assert.equal(validateTarget('url','https://example.com'),'https://example.com/');});
test('due reminders fire once',()=>{const date=new Date('2026-11-09T12:01:00');const task=normalizeItem('schedule',{title:'Praca',time:'12:00',days:[1]});const s=defaults();s.schedule=[task];assert.equal(dueTasks(s,date).length,1);s.reminded[`${dayKey(date)}:${task.id}:base`]=true;assert.equal(dueTasks(s,date).length,0);});
test('different day ignored',()=>{const date=new Date('2026-11-09T12:01:00');const task=normalizeItem('schedule',{title:'Praca',time:'12:00',days:[2]});const s=defaults();s.schedule=[task];assert.equal(dueTasks(s,date).length,0);});
test('overlap detection uses actual changed filenames',()=>{const p=[{number:3,title:'A',head:{ref:'a',sha:'aaa'}},{number:4,title:'B',head:{ref:'b',sha:'bbb'}}];const result=mergeRepoData(p,[],{3:['src/a.ts','src/b.ts'],4:['src/a.ts']});assert.equal(result.overlapping.length,1);assert.deepEqual(result.overlapping[0].files,['src/a.ts']);});
test('handoff never claims completed agent was verified',()=>{const s=defaults();s.agents=[normalizeItem('agents',{title:'Claude UX',status:'ready'})];const text=handoffText(s,null);assert.match(text,/nie stanowią dowodu testów/);assert.match(text,/niezaładowane/);});
test('store normalization isolates corrupt data',()=>{assert.deepEqual(normalizeStore(null),defaults());assert.equal(normalizeStore({schedule:'wrong'}).schedule.length,0);});

test('only latest relevant CI runs are used for alerts',()=>{
 const runs=[{name:'Build',head_branch:'main',head_sha:'2',status:'completed',conclusion:'success',created_at:'2026-11-09T11:00:00Z'},{name:'Build',head_branch:'main',head_sha:'1',status:'completed',conclusion:'failure',created_at:'2026-11-09T10:00:00Z'},{name:'Other',head_branch:'obsolete',head_sha:'0',status:'completed',conclusion:'failure',created_at:'2026-11-09T12:00:00Z'}];
 const result=mergeRepoData([],runs);assert.equal(result.runs.length,1);assert.equal(result.runs[0].conclusion,'success');
});

test('avatar size defaults to 84 and migrates older data',()=>{
  const s=defaults();assert.equal(s.settings.avatarSize,84);
  const old=normalizeStore({settings:{repo:'Zyczinho/city-route-app'},schedule:[]});
  assert.equal(old.settings.avatarSize,84);
  assert.equal(normalizeStore({settings:{avatarSize:72}}).settings.avatarSize,72);
  assert.equal(normalizeStore({settings:{avatarSize:100}}).settings.avatarSize,100);
  assert.equal(normalizeStore({settings:{avatarSize:999}}).settings.avatarSize,84);
});
