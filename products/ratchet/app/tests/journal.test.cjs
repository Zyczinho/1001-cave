'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {Journal,readEvents,claudeType,chatgptType}=require('../journal.cjs');

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'rachet-journal-'));
const T0=Date.parse('2026-11-12T05:00:00Z');

test('hook and tab events map to journal moments',()=>{
  assert.equal(claudeType('SessionStart','working'),'start');
  assert.equal(claudeType('UserPromptSubmit','working'),'prompt');
  assert.equal(claudeType('PostToolUse','working'),'work');
  assert.equal(claudeType('Stop','ready'),'done');
  assert.equal(claudeType('StopFailure','blocked'),'error');
  assert.equal(claudeType('Notification','needs_attention'),'needs_you');
  assert.equal(claudeType('Notification','ready'),null,'idle reminder is not a "needs you"');
  assert.equal(claudeType('SessionEnd','idle'),'end');
  assert.equal(chatgptType('working','ready'),'prompt','a chat that starts working means you sent a message');
  assert.equal(chatgptType('working','working'),'work');
  assert.equal(chatgptType('done','working'),'done');
  assert.equal(chatgptType('closed','working'),'end');
});

test('one day of events replays as a timeline; tool-call noise is thinned to one per minute',()=>{
  const dir=tmp();let now=T0;
  const j=new Journal({dir,now:()=>now});
  const at=(min,type,session='s1',project='city-route')=>{now=T0+min*60000;return j.record({src:'claude',project,session,type});};
  at(0,'start');at(0,'prompt');
  assert.ok(at(0.1,'work'));
  assert.equal(at(0.5,'work'),null,'second tool call within a minute is skipped');
  assert.ok(at(1.2,'work'));
  at(40,'needs_you');at(55,'prompt');
  assert.ok(at(55.1,'work'),'first work after your answer is always kept');
  at(90,'done');
  at(10,'start','s2','cv');
  const day=readEvents(dir,{from:'2026-11-12T00:00:00Z',to:'2026-11-13T00:00:00Z'});
  assert.deepEqual(day.filter(e=>e.session==='s1').map(e=>e.type),['start','prompt','work','work','needs_you','prompt','work','done']);
  assert.deepEqual(day.map(e=>e.ts),[...day.map(e=>e.ts)].sort(),'oldest first');
  assert.equal(day.find(e=>e.session==='s2').project,'cv');
  assert.deepEqual(Object.keys(day[0]).sort(),['project','session','src','ts','type'],'no prompt text or other fields');
});

test('bad input is skipped, damaged lines do not break reading, old months are pruned',()=>{
  const dir=tmp();
  const j=new Journal({dir,now:()=>T0});
  assert.equal(j.record({src:'claude',project:'x',session:'s',type:'nonsense'}),null);
  assert.equal(j.record({src:'gemini',project:'x',session:'s',type:'done'}),null);
  assert.equal(j.record({src:'claude',project:'a\nb',session:'s',type:'done'}).project,'a b');
  fs.appendFileSync(path.join(dir,'events-2026-11.jsonl'),'{"ts":"2026-11-12T05:0\n');
  assert.equal(readEvents(dir).length,1);
  fs.writeFileSync(path.join(dir,'events-2026-03.jsonl'),'');
  fs.writeFileSync(path.join(dir,'events-2026-06.jsonl'),'');
  new Journal({dir,now:()=>T0,keepMonths:6});
  assert.ok(!fs.existsSync(path.join(dir,'events-2026-03.jsonl')),'older than 6 months is removed');
  assert.ok(fs.existsSync(path.join(dir,'events-2026-06.jsonl')));
  assert.equal(new Journal({dir,enabled:false}).record({src:'claude',project:'x',session:'s',type:'done'}),null);
  assert.deepEqual(readEvents(path.join(dir,'missing')),[]);
});

function freePort(){return new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});}
test('server: Claude hooks and ChatGPT tab signals land in the local journal',async()=>{
  const [port,hookPort]=[await freePort(),await freePort()],folder=tmp();
  const proc=spawn(process.execPath,[path.resolve(__dirname,'../server.cjs')],{env:{...process.env,RATCHET_PORT:String(port),RATCHET_HOOK_PORT:String(hookPort),APPDATA:folder},stdio:'ignore'});
  try{
    for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:'+port+'/api/ping')).ok)break;}catch{}await new Promise(r=>setTimeout(r,75));}
    const cwd=path.join(folder,'city-route');
    const hook=e=>fetch('http://127.0.0.1:'+hookPort+'/hook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:'abc-123',hook_event_name:e,cwd,message:'tajny prompt'})});
    for(const e of ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Stop'])assert.equal((await hook(e)).status,204);
    const chat='https://chatgpt.com/g/g-p-6ae875411f64819199b53f8db8549b47-1001-cave/c/6af32fb0-3f14-83ed-8d8c-0fb848808289';
    const send=body=>fetch('http://127.0.0.1:'+port+'/api/browser-signal',{method:'POST',headers:{'Content-Type':'application/json','X-Ratchet-Local':'1',Origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop'},body:JSON.stringify(body)});
    assert.equal((await send({url:chat,state:'working',title:'CV'})).status,200);
    assert.equal((await send({url:chat,state:'done',title:'CV',visible:true,durationMs:1000})).status,200);
    const dir=path.join(folder,'Ratchet','dziennik');
    const events=readEvents(dir);
    assert.deepEqual(events.filter(e=>e.src==='claude').map(e=>e.type),['start','prompt','work','done']);
    assert.equal(events[0].project,'city-route');
    assert.deepEqual(events.filter(e=>e.src==='chatgpt').map(e=>[e.project,e.session,e.type]),
      [['1001-cave','6af32fb0-3f14-83ed-8d8c-0fb848808289','prompt'],['1001-cave','6af32fb0-3f14-83ed-8d8c-0fb848808289','done']]);
    const raw=fs.readdirSync(dir).map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    assert.doesNotMatch(raw,/tajny prompt|CV/,'no prompt text or chat titles are stored');
  } finally { proc.kill(); }
});
