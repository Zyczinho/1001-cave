'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {parseChatUrl,browserChatOutcome}=require('../core.cjs');

const PROJECT_CHAT='https://chatgpt.com/g/g-p-6ae875411f64819199b53f8db8549b47-1001-cave/c/6af32fb0-3f14-83ed-8d8c-0fb848808289';
const PLAIN_CHAT='https://chatgpt.com/c/6af32fb0-3f14-83ed-8d8c-0fb848808290';
const now=Date.parse('2026-11-10T22:00:00Z');
const working=(url,id)=>({id,source:'browser',status:'working',target:url,updatedAt:new Date(now-60000).toISOString()});

test('ChatGPT chat addresses: projects give a name, other sites and pages are refused',()=>{
  assert.deepEqual(parseChatUrl(PROJECT_CHAT),{url:PROJECT_CHAT,project:'1001-cave',conversation:'6af32fb0-3f14-83ed-8d8c-0fb848808289'});
  assert.equal(parseChatUrl(PLAIN_CHAT).project,'');
  for(const bad of ['https://chatgpt.com.evil.io/c/6af32fb0-3f14','https://chatgpt.com/g/g-p-6ae875411f64819199b53f8db8549b47-1001-cave/project','http://chatgpt.com/c/6af32fb0-3f14-83ed','javascript:alert(1)//chatgpt.com/c/12345678'])
    assert.equal(parseChatUrl(bad),null,bad);
});

test('ChatGPT done: notify only when you are elsewhere and the answer took a while',()=>{
  const prev=working(PROJECT_CHAT,'chatgpt:6af32fb0-3f14-83ed-8d8c-0fb848808289');
  const away=browserChatOutcome({url:PROJECT_CHAT,state:'done',title:'Wdrożenie poprawek Claude - ChatGPT',visible:false,durationMs:582000},{agents:[prev],now});
  assert.equal(away.status,'ready');
  assert.equal(away.title,'1001-cave · Wdrożenie poprawek Claude');
  assert.deepEqual(away.alert,{phase:'chatgpt-done',text:'Gotowe: 1001-cave — wejdź i zobacz.'});
  assert.equal(browserChatOutcome({url:PROJECT_CHAT,state:'done',visible:true,durationMs:582000},{agents:[prev],now}).alert,null,'watching the tab');
  assert.equal(browserChatOutcome({url:PROJECT_CHAT,state:'done',visible:false,durationMs:4000},{agents:[prev],now}).alert,null,'quick answer');
  assert.equal(browserChatOutcome({url:PROJECT_CHAT,state:'done',visible:false,durationMs:60000},{agents:[],now}).alert,null,'no working state seen first');
  assert.equal(browserChatOutcome({url:PROJECT_CHAT,state:'working'},{agents:[prev],now}).alert,null,'working is silent');
});

test('ChatGPT done: silent while another chat in the same project still works',()=>{
  const other='https://chatgpt.com/g/g-p-6ae875411f64819199b53f8db8549b47-1001-cave/c/7af32fb0-3f14-83ed-8d8c-0fb848808289';
  const agents=[working(PROJECT_CHAT,'chatgpt:6af32fb0-3f14-83ed-8d8c-0fb848808289'),working(other,'chatgpt:7af32fb0-3f14-83ed-8d8c-0fb848808289')];
  assert.equal(browserChatOutcome({url:PROJECT_CHAT,state:'done',visible:false,durationMs:60000},{agents,now}).alert,null);
});

test('closing a tab mid-answer leaves the chat idle, never "done"',()=>{
  const prev=working(PLAIN_CHAT,'chatgpt:6af32fb0-3f14-83ed-8d8c-0fb848808290');
  const r=browserChatOutcome({url:PLAIN_CHAT,state:'closed'},{agents:[prev],now});
  assert.equal(r.status,'idle');assert.equal(r.alert,null);
});

test('extension files: no conversation text is read, only Rachet on this computer is contacted',()=>{
  const dir=path.join(__dirname,'..','browser-extension');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  assert.deepEqual(manifest.host_permissions,['http://127.0.0.1:47823/*']);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://chatgpt.com/*']);
  assert.equal(manifest.permissions,undefined,'no extra browser permissions');
  const content=fs.readFileSync(path.join(dir,'content.js'),'utf8');
  assert.doesNotMatch(content,/innerText|textContent|innerHTML|fetch\(/,'content script must not read or send page text');
  const pkg=fs.readFileSync(path.join(__dirname,'..','scripts','build-candidate.cjs'),'utf8');
  for(const f of ['manifest.json','background.js','content.js','icon.png','CZYTAJ-MNIE.txt'])assert.ok(pkg.includes("'browser-extension/"+f+"'"),f+' is shipped');
});

function freePort(){return new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});}
test('server: the extension door accepts only extension origins and only chat signals',async()=>{
  const port=await freePort(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'rachet-browser-'));
  const proc=spawn(process.execPath,[path.resolve(__dirname,'../server.cjs')],{env:{...process.env,RATCHET_PORT:String(port),APPDATA:folder,RATCHET_DISABLE_HOOKS:'1'},stdio:'ignore'});
  try{
    for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:'+port+'/api/ping')).ok)break;}catch{}await new Promise(r=>setTimeout(r,75));}
    const send=(origin,body)=>fetch('http://127.0.0.1:'+port+'/api/browser-signal',{method:'POST',headers:{'Content-Type':'application/json','X-Ratchet-Local':'1',Origin:origin},body:JSON.stringify(body)});
    const ext='chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    assert.equal((await send('https://chatgpt.com',{url:PROJECT_CHAT,state:'working'})).status,403,'a web page cannot call it');
    assert.equal((await send(ext,{url:'https://evil.com/c/12345678',state:'working'})).status,400);
    assert.equal((await send(ext,{action:'quit'})).status,400,'no other actions through this door');
    assert.equal((await send(ext,{url:PROJECT_CHAT,state:'working',title:'Test'})).status,200);
    const done=await (await send(ext,{url:PROJECT_CHAT,state:'done',title:'Test',visible:false,durationMs:30000})).json();
    assert.equal(done.notified,true);
    const snap=await (await fetch('http://127.0.0.1:'+port+'/api/snapshot')).json();
    const agent=snap.state.agents.find(a=>a.id==='chatgpt:6af32fb0-3f14-83ed-8d8c-0fb848808289');
    assert.equal(agent.source,'browser');assert.equal(agent.status,'ready');assert.equal(agent.target,PROJECT_CHAT);
    assert.equal(snap.state.activity[0].agentId,agent.id);
    assert.equal((await fetch('http://127.0.0.1:'+port+'/api/ping')).ok,true,'still running');
  } finally { proc.kill(); }
});
