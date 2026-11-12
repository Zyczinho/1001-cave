'use strict';
// Guard pilot: when a guarded Claude session says "done", Rachet runs the task's proof and
// answers Claude's Stop hook with "block" until the proof passes (at most maxRounds times).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {guardVerdict,guardsFor,normalizeStore}=require('../core.cjs');
const proof=require('../straznik/city-route-google-photos.cjs');

const APP=path.join(__dirname,'..');
const ID_A='ChIJabcdefghij123',ID_B='ChIJklmnopqrst456';

function cityRoute(root,ids={}){
  fs.mkdirSync(path.join(root,'.git'),{recursive:true});
  fs.mkdirSync(path.join(root,'data','cities','warsaw'),{recursive:true});
  fs.mkdirSync(path.join(root,'data','google-place-ids'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','cities','warsaw','places.json'),JSON.stringify([
    {id:'lazienki',name:'Łazienki Królewskie'},{id:'koneser',name:'Koneser'}]));
  fs.writeFileSync(path.join(root,'data','google-place-ids','warsaw.json'),JSON.stringify({version:1,city:'warsaw',places:ids}));
}

test('verdict: pass, send back with the report, give up after the last round, never block on errors',()=>{
  assert.equal(guardVerdict({code:0,output:'DOWÓD spełniony',label:'Zdjęcia'}).verdict,'pass');
  const b=guardVerdict({code:1,output:'Bez identyfikatora Google: 37 z 658\nPrzykłady:',rounds:0,maxRounds:3,label:'Zdjęcia'});
  assert.equal(b.verdict,'block');assert.equal(b.rounds,1);
  assert.match(b.reason,/runda 1\/3/);assert.match(b.reason,/37 z 658/);
  assert.equal(guardVerdict({code:1,output:'x',rounds:3,maxRounds:3}).verdict,'give_up');
  assert.match(guardVerdict({code:1,output:'zostało 5',rounds:3,maxRounds:3,label:'Zdjęcia'}).alert,/^Potrzebuję Cię: Zdjęcia/);
  assert.equal(guardVerdict({code:2,output:'To nie jest folder City Route'}).verdict,'error');
  assert.equal(guardsFor('City-Route-App')[0].id,'city-route-google-photos');
  assert.deepEqual(guardsFor('1001-cave'),[]);
  const store=normalizeStore({guards:{'claude:s1':{guard:'city-route-google-photos',row:'r',rounds:2},'claude:s2':{guard:'nope'},'x':{guard:'city-route-google-photos'}}});
  assert.deepEqual(Object.keys(store.guards),['claude:s1'],'only known guards on Claude sessions survive a restart');
});

test('proof: counts places without a Google id by the app rule (id format + same name)',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guard-proof-'));
  cityRoute(root,{lazienki:{googlePlaceId:ID_A,name:'Lazienki Krolewskie'},koneser:{googlePlaceId:'bad id',name:'Koneser'}});
  const r=proof.check(root);
  assert.equal(r.missing,1,'Łazienki match after folding, Koneser has an invalid id');
  assert.match(proof.report(r),/Bez identyfikatora Google: 1 z 2 miejsc/);
  assert.equal(proof.check(os.tmpdir()).error!==undefined,true);
  const run=spawnSync(process.execPath,[path.join(APP,'straznik','city-route-google-photos.cjs'),root],{encoding:'utf8'});
  assert.equal(run.status,1);
});

test('end to end: a guarded session is sent back on Stop until the proof passes',{timeout:60000},async t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'guard-e2e-'));
  const appdata=path.join(base,'appdata'),root=path.join(base,'city-route-app');
  cityRoute(root);
  const port=47900+Math.floor(Math.random()*50),hookPort=port+60;
  const env={...process.env,APPDATA:appdata,RATCHET_PORT:String(port),RATCHET_HOOK_PORT:String(hookPort),RATCHET_DISABLE_JOURNAL:'1'};
  const server=spawn(process.execPath,[path.join(APP,'server.cjs')],{env,stdio:'ignore'});
  t.after(()=>server.kill());
  const api=`http://127.0.0.1:${port}`;
  for(let i=0;i<80;i++){try{if((await fetch(api+'/api/ping')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const hook=payload=>spawnSync(process.execPath,[path.join(APP,'scripts','claude-hook.cjs')],{env,input:JSON.stringify({session_id:'s1',cwd:root,...payload}),encoding:'utf8'});
  const action=(name,data)=>fetch(api+'/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Ratchet-Local':'1'},body:JSON.stringify({action:name,data})}).then(r=>r.json());

  hook({hook_event_name:'UserPromptSubmit'});
  const row='project:claude:city-route-app';
  const snap=await fetch(api+'/api/snapshot').then(r=>r.json());
  assert.equal(snap.guardOptions[row][0].id,'city-route-google-photos');
  const on=await action('guard:start',{id:row,guard:'city-route-google-photos'});
  assert.equal(on.ok,true,JSON.stringify(on));

  const first=hook({hook_event_name:'Stop',last_assistant_message:'Gotowe!'.repeat(20000)});
  const reply=JSON.parse(first.stdout);
  assert.equal(reply.decision,'block');
  assert.match(reply.reason,/runda 1\/3/);
  assert.match(reply.reason,/Bez identyfikatora Google: 2 z 2 miejsc/);
  let s=await fetch(api+'/api/snapshot').then(r=>r.json());
  assert.equal(s.state.agents.find(a=>a.id===row).status,'working','sent back = still working, no "done" alert');
  assert.ok(!s.state.activity.some(a=>a.phase==='agent-done'));

  cityRoute(root,{lazienki:{googlePlaceId:ID_A,name:'Łazienki Królewskie'},koneser:{googlePlaceId:ID_B,name:'Koneser'}});
  const second=hook({hook_event_name:'Stop'});
  assert.equal(second.stdout,'','proof passes: Claude may stop');
  s=await fetch(api+'/api/snapshot').then(r=>r.json());
  assert.deepEqual(s.state.guards,{},'the guard switches itself off once the task is proven');
  assert.ok(s.state.activity.some(a=>a.phase==='guard-pass'&&/Gotowe i sprawdzone/.test(a.text)));

  // Without a guard Stop never waits for anything and prints nothing.
  assert.equal(hook({hook_event_name:'Stop'}).stdout,'');
});

test('installer gives the Stop hook time for the proof and updates existing entries',()=>{
  const src=fs.readFileSync(path.join(APP,'scripts','install-claude-hooks.cjs'),'utf8');
  assert.match(src,/event==='Stop'\?150:5/);
  assert.match(src,/h\.timeout=timeoutFor\(event\)/);
  const pkg=fs.readFileSync(path.join(APP,'scripts','build-candidate.cjs'),'utf8');
  assert.ok(pkg.includes("'straznik/city-route-google-photos.cjs'"),'the proof ships with Rachet');
});
