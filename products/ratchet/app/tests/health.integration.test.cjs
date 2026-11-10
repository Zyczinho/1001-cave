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
    assert.deepEqual(await response.json(),{ok:true,version:'0.2.8'});
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
