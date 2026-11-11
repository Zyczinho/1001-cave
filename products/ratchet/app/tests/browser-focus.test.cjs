'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {BrowserFocus}=require('../core.cjs');

const CHAT='https://chatgpt.com/g/g-p-6ae875411f64819199b53f8db8549b47-1001-cave/c/6af32fb0-3f14-83ed-8d8c-0fb848808289';

test('no extension listening: Rachet is told to open the address itself',()=>{
  const focus=new BrowserFocus();
  assert.equal(focus.connected(),false);
  assert.equal(focus.request(CHAT),false);
});

test('a waiting extension gets the clicked chat at once',async()=>{
  const focus=new BrowserFocus();
  const waiting=focus.wait();
  assert.equal(focus.connected(),true);
  assert.equal(focus.request(CHAT),true);
  assert.equal(await waiting,CHAT);
});

test('a click between two polls is kept for the next poll, but not for long',async()=>{
  let now=1000;
  const focus=new BrowserFocus({now:()=>now});
  focus.wait().cancel();
  now+=6000;
  assert.equal(focus.connected(),false,'a request the browser dropped is not a listener');
  const poll=focus.wait();focus.request('first');await poll;
  now+=2000;
  assert.equal(focus.request(CHAT),true,'the extension polled two seconds ago');
  assert.equal(await focus.wait(),CHAT);
  focus.wait().cancel();
  now+=6000;
  assert.equal(focus.request(CHAT),false,'silent for six seconds: gone');
});

test('a quiet poll ends empty so the extension asks again',async()=>{
  const focus=new BrowserFocus({holdMs:20});
  assert.equal(await focus.wait(),'');
  assert.equal(focus.waiters.length,0);
});

test('extension: finds the open tab without the tabs permission, new tab only as a fallback',()=>{
  const dir=path.join(__dirname,'..','browser-extension');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  assert.equal(manifest.permissions,undefined);
  assert.deepEqual(manifest.host_permissions,['http://127.0.0.1:47823/*']);
  const background=fs.readFileSync(path.join(dir,'background.js'),'utf8');
  const found=background.indexOf('chrome.tabs.update(tab.id, { active: true })');
  const raised=background.indexOf('chrome.windows.update(tab.windowId, { focused: true })');
  const created=background.indexOf('chrome.tabs.create({ url })');
  assert.ok(found>0&&raised>found&&created>raised,'existing tab first, new tab last');
  assert.match(background,/if \(!wanted\) return;/,'only ChatGPT chat addresses are shown');
  const content=fs.readFileSync(path.join(dir,'content.js'),'utf8');
  assert.match(content,/msg\.type === 'rachet-where'\) reply\(\{ url: address\(\) \}\)/,'a tab answers with its address only');
});

function freePort(){return new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});}
test('server: an alert click reaches the waiting extension instead of opening a new tab',async()=>{
  const port=await freePort(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'rachet-focus-'));
  const proc=spawn(process.execPath,[path.resolve(__dirname,'../server.cjs')],{env:{...process.env,RATCHET_PORT:String(port),APPDATA:folder,RATCHET_DISABLE_HOOKS:'1'},stdio:'ignore'});
  const base='http://127.0.0.1:'+port+'/api/';
  const ext='chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  const post=(route,origin,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Ratchet-Local':'1',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  try{
    for(let i=0;i<60;i++){try{if((await fetch(base+'ping')).ok)break;}catch{}await new Promise(r=>setTimeout(r,75));}
    assert.equal((await post('browser-focus','https://chatgpt.com',{})).status,403,'a web page cannot listen for clicks');
    await post('browser-signal',ext,{url:CHAT,state:'working',title:'Test'});
    const done=await (await post('browser-signal',ext,{url:CHAT,state:'done',title:'Test',visible:false,durationMs:30000})).json();
    assert.equal(done.notified,true);
    const snap=await (await fetch(base+'snapshot')).json();
    const poll=post('browser-focus',ext,{});
    await new Promise(r=>setTimeout(r,150));
    const click=await (await post('action','',{action:'notification:open',data:{id:snap.state.activity[0].id}})).json();
    assert.deepEqual(click.result,{focus:'browser'});
    assert.deepEqual(await (await poll).json(),{url:CHAT});
  } finally { proc.kill(); }
});
