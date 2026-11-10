'use strict';
// Build an immutable Ratchet update candidate from the current working tree.
// This NEVER publishes to the ratchet-updates branch or modifies the app.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {CURRENT_VERSION,validateManifest}=require('../updater.cjs');

const source=path.resolve(__dirname,'..');
const packageFiles=[
  'README.md',
  'Ratchet-Backend.ps1','Ratchet-Kuleczka.ps1',
  'Uruchom-Ratchet-Bez-Electron.ps1','Instaluj-Ratchet.ps1',
  'Apply-Ratchet-Update.ps1','Zatrzymaj-Ratchet.ps1',
  'URUCHOM-RATCHET.cmd','ZAINSTALUJ-RAZ.cmd','AWARYJNIE-ZATRZYMAJ-RATCHET.cmd',
  'OTWORZ-TYLKO-PANEL.cmd','PODGLAD-OFFLINE.cmd',
  'Diagnostyka-Ratchet.ps1','Diagnostyka-Ratchet.cmd',
  'core.cjs','server.cjs','updater.cjs',
  'ui/browser-bridge.js','ui/icons.js',
  'ui/orb.css','ui/orb.html','ui/orb.js',
  'ui/panel.html','ui/panel.js','ui/preview.html','ui/style.css',
  'scripts/claude-hook.cjs','scripts/install-claude-hooks.cjs',
  'scripts/remove-claude-hooks.cjs','assets/ratchet.png'
];
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function buildCandidate(options={}){
  const version=String(options.version||CURRENT_VERSION);
  if(version!==CURRENT_VERSION)throw Error('Expected version '+CURRENT_VERSION);
  if(new Set(packageFiles).size!==packageFiles.length)throw Error('Duplicate release path');
  const contents=[];
  for(const relative of packageFiles){
    const file=path.join(source,...relative.split('/'));
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error('Missing release file: '+relative);
    contents.push({path:relative,bytes:fs.readFileSync(file)});
  }
  // All members of the file list are hashed and re-checked by older updaters.
  const ledger={
    version,
    source:'ratchet-updates/latest.json',
    files:contents.map(x=>({path:x.path,sha256:sha256(x.bytes)}))
  };
  const ledgerBytes=Buffer.from(JSON.stringify(ledger,null,2)+'\n','utf8');
  contents.push({path:'ratchet-release-manifest.json',bytes:ledgerBytes});
  const manifest=validateManifest({
    version,
    channel:'candidate',
    files:contents.map(x=>({path:x.path,sha256:sha256(x.bytes)}))
  });
  // The candidate marker cannot accidentally masquerade as stable/latest.json.
  const output=options.outputDir||fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-rc-'+version+'-'));
  if(fs.existsSync(output)&&fs.readdirSync(output).length)throw Error('Output directory is not empty');
  const releaseRoot=path.join(output,'ratchet-updates','releases','v'+version);
  fs.mkdirSync(releaseRoot,{recursive:true});
  for(const x of contents){
    const dst=path.join(releaseRoot,...x.path.split('/'));
    fs.mkdirSync(path.dirname(dst),{recursive:true});
    fs.writeFileSync(dst,x.bytes,{flag:'wx'});
    if(sha256(fs.readFileSync(dst))!==sha256(x.bytes))throw Error('Write verification failed: '+x.path);
  }
  const candidate={
    channel:'candidate',
    version,
    notes:'Ratchet '+version+' candidate: samodiagnostyka offline, hash ledger, naprawy stabilnosci. Nie publikowac bez Windows E2E.',
    files:manifest.files
  };
  fs.writeFileSync(path.join(output,'latest.candidate.json'),JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});
  return {output,version,files:contents.length,manifest:candidate};
}

if(require.main===module){
  try{
    const built=buildCandidate();
    console.log('RATCHET_RC_ONLY: '+built.output);
    console.log('FILES_VERIFIED: '+built.files);
    console.log('NOT_PUBLISHED: Windows native tests and user E2E are required before stable.');
  }catch(e){console.error('RATCHET_RC_FAILED: '+e.message);process.exitCode=1;}
}

module.exports={buildCandidate,packageFiles};
