'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {buildCandidate,packageFiles}=require('../scripts/build-candidate.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');

test('release candidate is complete, immutable and not automatically published',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-candidate-test-'));
  try {
    const commit='0123456789abcdef0123456789abcdef01234567';
    const result=buildCandidate({outputDir:dir,commit});
    assert.equal(result.version,'0.2.9');
    assert.equal(result.commit,commit);
    assert.equal(result.files,packageFiles.length+1);
    assert.ok(!fs.existsSync(path.join(dir,'latest.json')));
    assert.ok(!fs.existsSync(path.join(dir,'ratchet-updates','latest.json')));
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,'latest.candidate.json'),'utf8'));
    assert.equal(manifest.channel,'candidate');
    assert.equal(manifest.version,'0.2.9');
    assert.equal(manifest.commit,commit);
    // The user's ZIP has ONE folder: installer + readme at its root, program files under app/.
    const pkg=path.join(dir,'Ratchet-0.2.9-RC');
    assert.deepEqual(fs.readdirSync(pkg).sort(),['CZYTAJ-MNIE.txt','ZAINSTALUJ RATCHET.cmd','app']);
    const installedLedger=JSON.parse(fs.readFileSync(path.join(pkg,'app','ratchet-release-manifest.json'),'utf8'));
    assert.equal(installedLedger.commit,commit);
    const listed=new Set(installedLedger.files.map(f=>f.path).concat('ratchet-release-manifest.json'));
    const walk=(root,prefix='')=>fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(root,e.name),prefix+e.name+'/'):[prefix+e.name]);
    for(const file of walk(path.join(pkg,'app')))assert.ok(listed.has(file),'unlisted file in package: '+file);
    for(const f of installedLedger.files)assert.equal(hash(fs.readFileSync(path.join(pkg,'app',f.path))),f.sha256);
    for(const dev of ['PODGLAD-OFFLINE.cmd','ui/preview.html','scripts/build-candidate.cjs','tests/core.test.cjs'])assert.ok(!listed.has(dev),dev+' is a developer file');
    const release=path.join(dir,'ratchet-updates','releases','v0.2.9');
    for(const file of manifest.files){
      const bytes=fs.readFileSync(path.join(release,file.path));
      assert.equal(hash(bytes),file.sha256,'Checksum mismatch for '+file.path);
    }
    const ledger=JSON.parse(fs.readFileSync(path.join(release,'ratchet-release-manifest.json'),'utf8'));
    assert.equal(ledger.version,manifest.version);
    assert.equal(ledger.files.length,packageFiles.length);
    assert.ok(ledger.files.some(f=>f.path==='Diagnostyka-Ratchet.ps1'));
    assert.ok(ledger.files.some(f=>f.path==='assets/ratchet.ico'),'Windows shortcuts require the branded icon');
    assert.ok(ledger.files.every(f=>manifest.files.some(g=>g.path===f.path&&g.sha256===f.sha256)));
    assert.ok(manifest.files.some(f=>f.path==='ratchet-release-manifest.json'));
  }finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('candidate generator refuses missing/occupied output directory',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-candidate-busy-'));
  try {
    fs.writeFileSync(path.join(dir,'marker'),'do-not-overwrite');
    assert.throws(()=>buildCandidate({outputDir:dir}),/not empty/);
    assert.equal(fs.readFileSync(path.join(dir,'marker'),'utf8'),'do-not-overwrite');
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
