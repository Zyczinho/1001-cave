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

test('a project row stops saying "working" when its chats go quiet',()=>{
  const {rowStatus}=require('../core.cjs');
  const fresh={source:'browser',status:'working',updatedAt:new Date(now-60000).toISOString()};
  const silent={source:'browser',status:'working',updatedAt:new Date(now-4*60000).toISOString()};
  assert.equal(rowStatus([fresh],now),'working');
  assert.equal(rowStatus([silent],now),'idle','no confirmation for 3 minutes');
  assert.equal(rowStatus([silent,{source:'browser',status:'ready',updatedAt:new Date(now).toISOString()}],now),'ready');
  // A Claude Code session thinks longer without tool calls; it gets 30 minutes.
  assert.equal(rowStatus([{source:'hook',status:'working',updatedAt:new Date(now-10*60000).toISOString()}],now),'working');
  assert.equal(rowStatus([{source:'hook',status:'needs_attention',updatedAt:new Date(now).toISOString()},fresh],now),'needs_attention');
});

test('the extension sends "done" to the chat that answered, never to the one on screen',()=>{
  const content=fs.readFileSync(path.join(__dirname,'..','browser-extension','content.js'),'utf8');
  assert.match(content,/send\(here === workingUrl \? 'done' : 'closed', workingUrl/);
  assert.match(content,/if \(isChat\(workingUrl\)\) send\('closed', workingUrl\)/);
  assert.match(content,/send\('closed', workingUrl\)\; \}\);/);
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

test('old per-conversation rows are cleared on start, manual agents stay',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','server.cjs'),'utf8');
  const filter=new Function('a',"return "+src.match(/state\.agents=state\.agents\.filter\(a=>(.+?)\);\r?\n/)[1]);
  assert.equal(filter({id:'chatgpt:6af397e1-4e44',source:'manual'}),false,'0.2.9 saved chats as manual');
  assert.equal(filter({id:'claude:abc',source:'hook'}),false);
  assert.equal(filter({id:'project:chatgpt:1001-cave',source:'browser'}),true);
  assert.equal(filter({id:'3f2a-uuid',source:'manual'}),true,'an agent added by hand stays');
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
    // Two chats in one ChatGPT project are one row; it says done only when both are.
    const SECOND='https://chatgpt.com/g/g-p-6ae875411f64819199b53f8db8549b47-1001-cave/c/7af32fb0-3f14-83ed-8d8c-0fb848808289';
    assert.equal((await send(ext,{url:PROJECT_CHAT,state:'working',title:'Test'})).status,200);
    assert.equal((await send(ext,{url:SECOND,state:'working',title:'Drugi'})).status,200);
    const first=await (await send(ext,{url:SECOND,state:'done',title:'Drugi',visible:false,durationMs:30000})).json();
    assert.equal(first.notified,false,'the other chat in the project still works');
    assert.equal(first.status,'working');
    const done=await (await send(ext,{url:PROJECT_CHAT,state:'done',title:'Test',visible:false,durationMs:30000})).json();
    assert.equal(done.notified,true);
    assert.equal(done.row,'project:chatgpt:1001-cave');
    const snap=await (await fetch('http://127.0.0.1:'+port+'/api/snapshot')).json();
    const rows=snap.state.agents.filter(a=>a.source==='browser');
    assert.equal(rows.length,1,'one row per project, not per conversation');
    const agent=rows[0];
    assert.equal(agent.title,'1001-cave');assert.equal(agent.status,'ready');assert.equal(agent.target,PROJECT_CHAT);
    assert.equal(snap.state.activity[0].agentId,agent.id);
    assert.equal(snap.state.activity[0].target,PROJECT_CHAT,'the alert opens the chat that finished');
    assert.equal((await fetch('http://127.0.0.1:'+port+'/api/ping')).ok,true,'still running');
  } finally { proc.kill(); }
});
