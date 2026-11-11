'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {openWait,closeWaits,waitSummary,normalizeWaits,normalizeStore}=require('../core.cjs');

const T=Date.parse('2026-11-11T10:00:00');
const MIN=60000;

test('a wait starts when the work ended, not when the alert was noticed',()=>{
  const waits=[];
  const w=openWait(waits,{key:'chatgpt:abc',row:'project:chatgpt:cave',title:'cave',source:'browser',at:T,lagMs:45000});
  assert.equal(Date.parse(w.readyAt),T-45000);
  assert.equal(w.lagMs,45000);
  assert.equal(openWait(waits,{key:'chatgpt:abc',row:'project:chatgpt:cave',at:T+MIN}),null,'one open wait per chat');
  assert.equal(waits.length,1);
});

test('a wait closes for its own session, or for the whole row on a click',()=>{
  const waits=[];
  openWait(waits,{key:'claude:a',row:'project:claude:cave',at:T});
  openWait(waits,{key:'claude:b',row:'project:claude:cave',at:T});
  openWait(waits,{key:'claude:c',row:'project:claude:other',at:T});
  assert.equal(closeWaits(waits,{key:'claude:a'},T+2*MIN),1);
  assert.equal(waits.find(w=>w.key==='claude:b').seenAt,'','another session in the project still waits');
  assert.equal(closeWaits(waits,{row:'project:claude:cave'},T+5*MIN),1);
  assert.equal(closeWaits(waits,{row:'project:claude:cave'},T+9*MIN),0,'already closed stays as it was');
  assert.equal(waits.find(w=>w.key==='claude:c').seenAt,'');
  assert.equal(closeWaits(waits,{},T),0,'no key and no row closes nothing');
});

test('daily minutes count only waits that really ended; the rest is listed apart',()=>{
  const waits=[];
  openWait(waits,{key:'k1',row:'r',at:T});closeWaits(waits,{key:'k1'},T+4*MIN);
  openWait(waits,{key:'k2',row:'r',at:T+10*MIN});closeWaits(waits,{key:'k2'},T+10*MIN+90000);
  openWait(waits,{key:'k3',row:'r',at:T+20*MIN});closeWaits(waits,{key:'k3'},T+20*MIN+9*3600000);
  openWait(waits,{key:'k4',row:'r',at:T+30*MIN,lagMs:30000});
  const [day]=waitSummary(waits,{now:T+60*MIN});
  assert.equal(day.day,'2026-11-11');
  assert.equal(day.answered,2);
  assert.equal(day.minutes,5.5);
  assert.equal(day.longestMinutes,4);
  assert.equal(day.leftForLater,1,'nine hours is not waiting, it is left for later');
  assert.equal(day.open,1,'still waiting: not counted until it ends');
  assert.equal(day.lateAlerts,1);
  assert.deepEqual(waitSummary(waits,{now:T+30*86400000}),[],'older than the window');
});

test('the profile keeps only well-formed waits',()=>{
  const kept=normalizeWaits([{key:'k',row:'r',readyAt:'2026-11-11T09:00:00Z',seenAt:'nonsense',lagMs:-5},{key:'x'},null,'text']);
  assert.equal(kept.length,1);
  assert.equal(kept[0].seenAt,'');assert.equal(kept[0].lagMs,0);
  assert.deepEqual(normalizeStore({}).waits,[]);
  assert.equal(normalizeStore({waits:[{key:'k',row:'r',readyAt:'2026-11-11T09:00:00Z'}]}).waits.length,1);
});

test('extension: "done" does not depend on the slow background timer',()=>{
  const content=fs.readFileSync(path.join(__dirname,'..','browser-extension','content.js'),'utf8');
  assert.match(content,/new MutationObserver\(/);
  assert.match(content,/confirmTimer = setTimeout\(\(\) => \{ confirmTimer = 0; tick\(\); \}, QUIET_MS\)/);
  assert.match(content,/setInterval\(tick, 1000\)/,'the timer stays as a safety net');
  assert.match(content,/lagMs: now - lastBusy/);
  assert.match(content,/send\('seen', unseenUrl\)/);
});

function freePort(){return new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});}
test('server: an alert opens a wait and looking at the chat closes it',async()=>{
  const CHAT='https://chatgpt.com/g/g-p-6ae875411f64819199b53f8db8549b47-1001-cave/c/6af32fb0-3f14-83ed-8d8c-0fb848808289';
  const port=await freePort(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'rachet-waits-'));
  const proc=spawn(process.execPath,[path.resolve(__dirname,'../server.cjs')],{env:{...process.env,RATCHET_PORT:String(port),APPDATA:folder,RATCHET_DISABLE_HOOKS:'1'},stdio:'ignore'});
  const base='http://127.0.0.1:'+port+'/api/';
  const send=body=>fetch(base+'browser-signal',{method:'POST',headers:{'Content-Type':'application/json','X-Ratchet-Local':'1',Origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop'},body:JSON.stringify(body)});
  const waits=async()=>(await (await fetch(base+'snapshot')).json());
  try{
    for(let i=0;i<60;i++){try{if((await fetch(base+'ping')).ok)break;}catch{}await new Promise(r=>setTimeout(r,75));}
    await send({url:CHAT,state:'working',title:'Test'});
    await send({url:CHAT,state:'done',title:'Test',visible:true,durationMs:30000});
    assert.equal((await waits()).state.waits.length,0,'you were watching: nothing waited');
    await send({url:CHAT,state:'working',title:'Test'});
    await send({url:CHAT,state:'done',title:'Test',visible:false,durationMs:30000,lagMs:3000});
    let snap=await waits();
    assert.equal(snap.state.waits.length,1);
    assert.equal(snap.state.waits[0].seenAt,'');
    assert.equal(snap.state.waits[0].lagMs,3000);
    assert.equal(snap.waitDays[0].open,1);
    assert.equal((await send({url:'https://evil.com/c/12345678',state:'seen'})).status,400);
    assert.deepEqual(await (await send({url:CHAT,state:'seen'})).json(),{ok:true,seen:1});
    snap=await waits();
    assert.notEqual(snap.state.waits[0].seenAt,'');
    assert.equal(snap.waitDays[0].answered,1);
    assert.equal(snap.state.agents.find(a=>a.source==='browser').status,'ready','looking does not change the row');
  } finally { proc.kill(); }
});
