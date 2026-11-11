'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {compareVersion,validateManifest,sha256}=require('../updater.cjs');
test('semver comparison',()=>{assert.equal(compareVersion('0.2.4','0.2.3'),1);assert.equal(compareVersion('0.2.3','0.2.3'),0);assert.equal(compareVersion('0.2.2','0.2.3'),-1);assert.equal(compareVersion('1.0.0','0.99.99'),1);});
test('manifest rejects traversal',()=>{assert.throws(()=>validateManifest({version:'0.2.4',files:[{path:'../secrets.txt',sha256:'a'.repeat(64)}]}));});
test('manifest rejects duplicate files',()=>{assert.throws(()=>validateManifest({version:'0.2.4',files:[{path:'ui/panel.js',sha256:'a'.repeat(64)},{path:'ui/panel.js',sha256:'b'.repeat(64)}]}));});
test('manifest requires SHA256',()=>{assert.throws(()=>validateManifest({version:'0.2.4',files:[{path:'ui/panel.js',sha256:'abc'}]}));});
test('manifest accepts correct files',()=>{assert.equal(validateManifest({version:'0.2.4',files:[{path:'ui/panel.js',sha256:'a'.repeat(64)}]}).files.length,1);});
test('sha256 matches reference digest',()=>assert.equal(sha256(Buffer.from('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));

const fs=require('node:fs'),path=require('node:path');
const {stageUpdate,CURRENT_VERSION}=require('../updater.cjs');

test('stages checked files and creates a local hash ledger automatically',async()=>{
  assert.equal(CURRENT_VERSION,'0.2.9');
  const payload=Buffer.from('safe test file','utf8');
  const manifest={version:'0.3.0',files:[{path:'ui/panel.js',sha256:sha256(payload)}]};
  const original=global.fetch;
  global.fetch=async()=>new Response(payload,{status:200});
  let dir;
  try{
    dir=await stageUpdate(manifest);
    const list=JSON.parse(fs.readFileSync(path.join(dir,'ratchet-update-list.json'),'utf8'));
    assert.deepEqual(list,['ui/panel.js','ratchet-release-manifest.json']);
    const local=JSON.parse(fs.readFileSync(path.join(dir,'ratchet-release-manifest.json'),'utf8'));
    assert.equal(local.version,'0.3.0');
    assert.deepEqual(local.files,manifest.files);
  }finally{global.fetch=original;if(dir)fs.rmSync(dir,{force:true,recursive:true})}
});

test('first upgrade accepts prebuilt ledger for older updater',async()=>{
  const payload=Buffer.from('fixture panel','utf8');
  const file={path:'ui/panel.js',sha256:sha256(payload)};
  const ledgerBytes=Buffer.from(JSON.stringify({version:'0.3.0',source:'release',files:[file]}));
  const manifest={version:'0.3.0',files:[file,{path:'ratchet-release-manifest.json',sha256:sha256(ledgerBytes)}]};
  const original=global.fetch;
  global.fetch=async url=>new Response(url.endsWith('/ratchet-release-manifest.json')?ledgerBytes:payload,{status:200});
  let dir;
  try{
    dir=await stageUpdate(manifest);
    const list=JSON.parse(fs.readFileSync(path.join(dir,'ratchet-update-list.json'),'utf8'));
    assert.deepEqual(list,['ui/panel.js','ratchet-release-manifest.json']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'ratchet-release-manifest.json'),'utf8')).files,[file]);
  }finally{global.fetch=original;if(dir)fs.rmSync(dir,{force:true,recursive:true})}
});
