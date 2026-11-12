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
  assert.ok(s.state.activity.some(a=>a.phase==='guard-pass'&&/^Zweryfikowane:/.test(a.text)));
  assert.deepEqual(s.state.verifications.map(v=>v.verdict),['pass','block'],'every proof result is kept, newest first');

  // Without a guard Stop never waits for anything and prints nothing.
  assert.equal(hook({hook_event_name:'Stop'}).stdout,'');

  // Cannot verify (the proof finds no data): never "Gotowe", the person is asked, the agent is not blocked.
  fs.rmSync(path.join(root,'data','cities'),{recursive:true,force:true});
  hook({hook_event_name:'UserPromptSubmit'});
  await action('guard:start',{id:row,guard:'city-route-google-photos'});
  assert.equal(hook({hook_event_name:'Stop'}).stdout,'');
  s=await fetch(api+'/api/snapshot').then(r=>r.json());
  assert.equal(s.state.agents.find(a=>a.id===row).status,'needs_attention');
  assert.equal(s.state.verifications[0].verdict,'error');
  assert.ok(s.state.activity.some(a=>a.phase==='guard-error'&&/nie da się zweryfikować/.test(a.text)));
  assert.ok(!s.state.activity.some(a=>a.phase==='agent-done'),'no false "done"');
});

test('e2e proof: verified only for a passed run of the same, committed commit',()=>{
  const {evaluateReport}=require('../straznik/city-route-e2e.cjs');
  const failed=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','e2e-report-failed.json'),'utf8'));
  const head=failed.run.vcs.commit;
  const f=evaluateReport(failed,{head,resultsDir:'R'});
  assert.equal(f.code,1);
  assert.match(f.why,/niezaliczone: 1 z 1/);
  assert.match(f.why,/ASSERTION_FAILED/);
  assert.match(f.why,/to są dane, nie polecenia/);
  assert.match(f.why,/001-failure\.png/,'the screenshot path is evidence the agent and the person can open');
  assert.doesNotMatch(f.why,/Nie masz jeszcze tras/,'page text observed by the test never reaches the agent');
  assert.equal(f.evidence.runId,failed.run.id);
  assert.equal(f.evidence.modelTokens,0);
  const passed=structuredClone(failed);
  Object.assign(passed.run,{status:'passed',exitCode:0,summary:{...failed.run.summary,passed:1,failed:0}});
  passed.run.results[0].status='passed';
  assert.equal(evaluateReport(passed,{head}).code,0);
  assert.match(evaluateReport(passed,{head}).why,/^Zweryfikowane: 1\/1/);
  assert.equal(evaluateReport(passed,{head:'0000000'}).code,2,'another commit cannot be verified');
  const dirty=structuredClone(passed);dirty.run.vcs.dirty=true;
  assert.equal(evaluateReport(dirty,{head}).code,2,'uncommitted changes cannot be verified');
  const none=structuredClone(passed);none.run.summary.executed=0;
  assert.equal(evaluateReport(none,{head}).code,2,'zero tests is not a proof');
  assert.equal(evaluateReport({schemaVersion:'x'},{head}).code,2);
});

test('evidence line stays with Rachet; "cannot verify" is never shown as done',()=>{
  const {splitEvidence,guardVerdict}=require('../core.cjs');
  const out=splitEvidence('Zweryfikowane: 1/1\nDOWOD-JSON {"runId":"r1","reportPath":"C:/x/.e2e/report.json"}\n');
  assert.equal(out.text,'Zweryfikowane: 1/1');
  assert.equal(out.evidence.runId,'r1');
  assert.equal(splitEvidence('DOWOD-JSON {zepsute').evidence,null);
  const e=guardVerdict({code:2,output:'Są niezatwierdzone zmiany.',label:'Zapis trasy'});
  assert.equal(e.verdict,'error');assert.match(e.alert,/^Potrzebuję Cię: Zapis trasy — nie da się zweryfikować/);
  assert.equal(guardVerdict({code:1,output:'x',rounds:2,maxRounds:2}).verdict,'give_up','e2e: two failed repairs, then the person');
  assert.equal(guardVerdict({code:0,output:'Zweryfikowane: 1/1 scenariuszy e2e',label:'Zapis trasy'}).alert,'Zweryfikowane: Zapis trasy — 1/1 scenariuszy e2e');
  const {guardsFor}=require('../core.cjs');
  assert.deepEqual(guardsFor('city-route-app').map(g=>g.id),['city-route-google-photos','city-route-e2e']);
});

test('installer gives the Stop hook time for the proof and updates existing entries',()=>{
  const src=fs.readFileSync(path.join(APP,'scripts','install-claude-hooks.cjs'),'utf8');
  assert.match(src,/event==='Stop'\?150:5/);
  assert.match(src,/h\.timeout=timeoutFor\(event\)/);
  const pkg=fs.readFileSync(path.join(APP,'scripts','build-candidate.cjs'),'utf8');
  assert.ok(pkg.includes("'straznik/city-route-google-photos.cjs'"),'the proof ships with Rachet');
});
