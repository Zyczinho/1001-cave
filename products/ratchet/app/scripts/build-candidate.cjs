'use strict';
// Build an immutable Ratchet release candidate from the current working tree.
// This NEVER publishes to the ratchet-updates branch or modifies the app.
//
// Output:
//   <out>/Ratchet-<version>-RC/            <- the ONE folder inside the user's ZIP
//         ZAINSTALUJ RATCHET.cmd, CZYTAJ-MNIE.txt
//         app/<program files> + app/ratchet-release-manifest.json (SHA-256 + commit)
//   <out>/ratchet-updates/releases/v<version>/  <- flat layout for the in-app updater
//   <out>/latest.candidate.json
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {CURRENT_VERSION,validateManifest}=require('../updater.cjs');

const source=path.resolve(__dirname,'..');
const installerRoot=path.resolve(source,'..','installer');
// Only what the installed program needs. Developer tools and old one-off
// installers stay out of the package so nothing technical lands on a Desktop.
const packageFiles=[
  'README.md',
  'Ratchet-Backend.ps1','Ratchet-Kuleczka.ps1','Uruchom-Ratchet-Bez-Electron.ps1',
  'Instaluj-Ratchet.ps1','Apply-Ratchet-Update.ps1','Zatrzymaj-Ratchet.ps1','Diagnostyka-Ratchet.ps1',
  'core.cjs','coordinator.cjs','chatgpt-workspace.cjs','chatgpt-signal.cjs','server.cjs','updater.cjs',
  'ui/browser-bridge.js','ui/icons.js',
  'ui/orb.css','ui/orb.html','ui/orb.js',
  'ui/panel.html','ui/panel.js','ui/style.css',
  'scripts/claude-hook.cjs','scripts/install-claude-hooks.cjs',
  'scripts/remove-claude-hooks.cjs','assets/ratchet.png','assets/ratchet.ico',
  'browser-extension/manifest.json','browser-extension/background.js','browser-extension/content.js',
  'browser-extension/icon.png','browser-extension/CZYTAJ-MNIE.txt'
];
const rootFiles=['ZAINSTALUJ RATCHET.cmd','CZYTAJ-MNIE.txt'];
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function resolveCommit(explicit){
  const value=String(explicit||process.env.RATCHET_COMMIT||process.env.GITHUB_SHA||'').trim();
  if(value){
    if(!/^[0-9a-f]{40}$/.test(value))throw Error('Commit must be a full 40-character SHA');
    return value;
  }
  try{
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    return /^[0-9a-f]{40}$/.test(head)?head:null;
  }catch{return null;}
}

function writeVerified(file,bytes){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,bytes,{flag:'wx'});
  if(sha256(fs.readFileSync(file))!==sha256(bytes))throw Error('Write verification failed: '+file);
}

function buildCandidate(options={}){
  const version=String(options.version||CURRENT_VERSION);
  if(version!==CURRENT_VERSION)throw Error('Expected version '+CURRENT_VERSION);
  if(new Set(packageFiles).size!==packageFiles.length)throw Error('Duplicate release path');
  const commit=resolveCommit(options.commit);
  const contents=[];
  for(const relative of packageFiles){
    const file=path.join(source,...relative.split('/'));
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error('Missing release file: '+relative);
    contents.push({path:relative,bytes:fs.readFileSync(file)});
  }
  // All members of the file list are hashed and re-checked by the installer and updater.
  const ledger={
    version,
    commit,
    builtAt:new Date().toISOString(),
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
  const output=options.outputDir||fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-rc-'+version+'-'));
  if(fs.existsSync(output)&&fs.readdirSync(output).length)throw Error('Output directory is not empty');

  // 1) Installable package: one top-level folder, installer at the root, program in app/.
  const packageName='Ratchet-'+version+'-RC';
  const packageRoot=path.join(output,packageName);
  for(const x of contents)writeVerified(path.join(packageRoot,'app',...x.path.split('/')),x.bytes);
  for(const name of rootFiles){
    const file=path.join(installerRoot,name);
    if(!fs.existsSync(file))throw Error('Missing installer file: '+name);
    writeVerified(path.join(packageRoot,name),fs.readFileSync(file));
  }

  // 2) Update channel layout (flat), unchanged contract for the in-app updater.
  const releaseRoot=path.join(output,'ratchet-updates','releases','v'+version);
  for(const x of contents)writeVerified(path.join(releaseRoot,...x.path.split('/')),x.bytes);
  const candidate={
    channel:'candidate',
    version,
    commit,
    notes:'Ratchet '+version+' candidate: osobny profil Edge dla małego panelu, uruchamianie bez konsoli, instalator z manifestem. Nie publikować bez testu na komputerze użytkownika.',
    files:manifest.files
  };
  fs.writeFileSync(path.join(output,'latest.candidate.json'),JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});
  return {output,version,commit,packageName,packageRoot,files:contents.length,manifest:candidate};
}

if(require.main===module){
  try{
    const built=buildCandidate();
    console.log('RATCHET_RC_ONLY: '+built.output);
    console.log('PACKAGE: '+built.packageRoot);
    console.log('COMMIT: '+(built.commit||'unknown'));
    console.log('FILES_VERIFIED: '+built.files);
    console.log('NOT_PUBLISHED: Windows native tests and user E2E are required before stable.');
  }catch(e){console.error('RATCHET_RC_FAILED: '+e.message);process.exitCode=1;}
}

module.exports={buildCandidate,packageFiles};
