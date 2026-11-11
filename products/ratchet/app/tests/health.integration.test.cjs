'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const net=require('node:net');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function getFreePort(){return new Promise((resolve,reject)=>{
  const server=net.createServer(); server.once('error',reject);server.listen(0,'127.0.0.1',()=>{
    const port=server.address().port;server.close(()=>resolve(port));
  });
});}
async function boot(port,folder){
  const proc=spawn(process.execPath,[path.resolve(__dirname,'../server.cjs')],{
    env:{...process.env,RATCHET_PORT:String(port),APPDATA:folder,RATCHET_DISABLE_HOOKS:'1'},
    stdio:['ignore','pipe','pipe']
  });
  let error='';proc.stderr.on('data',x=>error+=x.toString());
  for(let i=0;i<60;i++){
    if(proc.exitCode!==null)throw Error('Ratchet exited: '+error);
    try {const r=await fetch('http://127.0.0.1:'+port+'/api/ping');if(r.ok) return proc;}catch{}
    await delay(75);
  }
  proc.kill(); throw Error('Server not listening: '+error);
}
const action=(port,data,headers={})=>fetch('http://127.0.0.1:'+port+'/api/action',{
  method:'POST',headers:{'Content-Type':'application/json','X-Ratchet-Local':'1',...headers},body:JSON.stringify(data)
});
test('local backend: health, permissions, persistence and controlled exit',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-integ-'));
  const port=await getFreePort();
  let proc;
  try{
    proc=await boot(port,dir);
    let response=await fetch('http://127.0.0.1:'+port+'/api/ping');
    const ping=await response.json();
    assert.equal(ping.ok,true);assert.equal(ping.version,'0.2.9');
    assert.equal(path.resolve(ping.root),path.resolve(__dirname,'..'),'ping must reveal which copy of Ratchet is running');
    assert.equal(typeof ping.pid,'number');
    response=await action(port,{action:'item:save',data:{collection:'links',item:{id:'a',title:'Example',kind:'url',target:'https://example.com'}}});
    assert.equal(response.status,200);
    response=await action(port,{action:'item:save',data:{collection:'links',item:{id:'b',title:'Example B',kind:'url',target:'https://example.org'}}});
    assert.equal(response.status,200);
    assert.ok(fs.existsSync(path.join(dir,'Ratchet','ratchet.json.bak')));
    response=await action(port,{action:'item:remove',data:{collection:'links',id:'a'}},{Origin:'https://untrusted.example'});
    assert.equal(response.status,403);
    const snap=await (await fetch('http://127.0.0.1:'+port+'/api/snapshot')).json();
    assert.ok(snap.state.links.some(x=>x.id==='a'));
    response=await action(port,{action:'quit',data:{}});
    assert.equal(response.status,200);
    await delay(750);
    proc.kill();
    await new Promise(resolve=>proc.once('exit',resolve));
    proc=await boot(port,dir);
    const after=await (await fetch('http://127.0.0.1:'+port+'/api/snapshot')).json();
    assert.ok(after.state.links.some(x=>x.id==='a'));
    assert.ok(after.state.links.some(x=>x.id==='b'));
    // Simulate an interrupted file write: last good backup must survive recovery.
    proc.kill();await new Promise(resolve=>proc.once('exit',resolve));
    const profile=path.join(dir,'Ratchet','ratchet.json');
    fs.writeFileSync(profile,'{corrupt data','utf8');
    proc=await boot(port,dir);
    const restored=await (await fetch('http://127.0.0.1:'+port+'/api/snapshot')).json();
    assert.ok(restored.state.links.some(x=>x.id==='a'));
    assert.ok(fs.readFileSync(profile,'utf8').startsWith('{'));
    assert.doesNotThrow(()=>JSON.parse(fs.readFileSync(profile,'utf8')));
    assert.ok(fs.readdirSync(path.dirname(profile)).some(x=>x.startsWith('ratchet.json.corrupt-')));
  } finally {
    if(proc && proc.exitCode===null){proc.kill();await Promise.race([new Promise(r=>proc.once('exit',r)),delay(1000)]);}
    fs.rmSync(dir,{recursive:true,force:true});
  }
},{timeout:13000});

test('profile written with a UTF-8 BOM still starts; orb/panel settings persist and validate',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-bom-'));
  const port=await getFreePort();
  let proc;
  try{
    const profile=path.join(dir,'Ratchet','ratchet.json');
    fs.mkdirSync(path.dirname(profile),{recursive:true});
    const original='﻿'+JSON.stringify({version:1,settings:{avatarSize:56},links:[{id:'mine',title:'Moje',kind:'url',target:'https://example.com',group:'X'}]});
    fs.writeFileSync(profile,original,'utf8');
    proc=await boot(port,dir);
    const snap=await (await fetch('http://127.0.0.1:'+port+'/api/snapshot')).json();
    assert.ok(snap.state.links.some(x=>x.id==='mine'),'BOM profile must load the user data');
    assert.equal(snap.state.settings.avatarSize,56);
    assert.equal(fs.readFileSync(profile,'utf8'),original,'reading must not rewrite the profile');
    // Remembered panel size: valid sizes kept, a desktop-sized window rejected, null resets.
    await action(port,{action:'settings:save',data:{settings:{panelSize:{w:400,h:600}}}});
    let status=await (await fetch('http://127.0.0.1:'+port+'/api/status')).json();
    assert.deepEqual(status.panelSize,{w:400,h:600});
    await action(port,{action:'settings:save',data:{settings:{panelSize:{w:1800,h:1000}}}});
    status=await (await fetch('http://127.0.0.1:'+port+'/api/status')).json();
    assert.equal(status.panelSize,null);
    // Orb position survives restarts; reset clears it and signals the orb.
    let r=await action(port,{action:'orb:position',data:{x:1200,y:300}});
    assert.equal(r.status,200);
    status=await (await fetch('http://127.0.0.1:'+port+'/api/status')).json();
    assert.deepEqual(status.orbPosition,{x:1200,y:300});
    r=await action(port,{action:'orb:position',data:{x:'abc',y:1}});
    assert.equal(r.status,400);
    await action(port,{action:'orb:reset',data:{}});
    status=await (await fetch('http://127.0.0.1:'+port+'/api/status')).json();
    assert.equal(status.orbPosition,null);
    assert.equal(status.orbResetRequests,1);
    assert.equal(status.alwaysOnTop,true);
    assert.equal(status.autoStart,false);
  } finally {
    if(proc && proc.exitCode===null){proc.kill();await Promise.race([new Promise(r=>proc.once('exit',r)),delay(1000)]);}
    fs.rmSync(dir,{recursive:true,force:true});
  }
},{timeout:13000});
