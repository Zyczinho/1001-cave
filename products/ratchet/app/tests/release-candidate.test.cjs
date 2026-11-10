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
    const result=buildCandidate({outputDir:dir});
    assert.equal(result.version,'0.2.8');
    assert.equal(result.files,packageFiles.length+1);
    assert.ok(!fs.existsSync(path.join(dir,'latest.json')));
    assert.ok(!fs.existsSync(path.join(dir,'ratchet-updates','latest.json')));
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,'latest.candidate.json'),'utf8'));
    assert.equal(manifest.channel,'candidate');
    assert.equal(manifest.version,'0.2.8');
    const release=path.join(dir,'ratchet-updates','releases','v0.2.8');
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
