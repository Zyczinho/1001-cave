'use strict';
// Ratchet updates: fixed publisher, verified SHA-256, local staging, rollback in PowerShell.
// This module never applies updates while Node has any of the files open.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);
const BASE = 'https://raw.githubusercontent.com/Zyczinho/1001-cave/ratchet-updates/ratchet-updates';
const MANIFEST = BASE + '/latest.json';
const CURRENT_VERSION = '0.2.8';
const INSTALLED_MANIFEST = 'ratchet-release-manifest.json';
const ALLOWED = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(?:cmd|ps1|cjs|js|html|css|json|md|txt|png|ico)$/;

function compareVersion(a,b) {
  const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);
  if(x.length!==3||y.length!==3||![...x,...y].every(n=>Number.isInteger(n)&&n>=0))throw Error('Niepoprawny numer wersji');
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;
  return 0;
}
function validateManifest(obj) {
  if(!obj || typeof obj!=='object' || !/^\d+\.\d+\.\d+$/.test(obj.version)||!Array.isArray(obj.files)||obj.files.length>100)throw Error('Niepoprawny manifest aktualizacji');
  const unique=new Set();
  for(const item of obj.files){
    if(!item||typeof item.path!=='string'||!ALLOWED.test(item.path)||item.path.includes('..')||item.path.startsWith('/')||item.path.includes('\\')||!(/^[a-f0-9]{64}$/).test(item.sha256)||unique.has(item.path))throw Error('Niepoprawny lub zdublowany plik aktualizacji');
    unique.add(item.path);
  }
  return {version:obj.version,notes:String(obj.notes||'').slice(0,800),files:obj.files.map(f=>({path:f.path,sha256:f.sha256}))};
}
function sha256(data){return crypto.createHash('sha256').update(data).digest('hex');}
async function fetchBytes(url,limit=4*1024*1024){
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Ratchet-Updater/0.2.8'}});
  if(response.status===404){
    // Keep all repositories private: reuse the user's existing GitHub CLI login.
    // We never access or store the user's access token ourselves.
    const suffix=url.startsWith(BASE+'/')?url.slice((BASE+'/').length):null;
    if(!suffix||!/^[-\w./]+$/.test(suffix))throw Error('Nieznane źródło aktualizacji');
    const endpoint='repos/Zyczinho/1001-cave/contents/ratchet-updates/'+suffix+'?ref=ratchet-updates';
    try{
      const {stdout}=await execFileAsync('gh',['api','-H','Accept: application/vnd.github.raw+json',endpoint],{encoding:'buffer',windowsHide:true,timeout:15000,maxBuffer:limit+32768});
      const bytes=Buffer.isBuffer(stdout)?stdout:Buffer.from(stdout);
      if(bytes.length>limit)throw Error('Zbyt duży plik aktualizacji');
      return bytes;
    }catch(e){
      throw Error('Kanał GitHub jest prywatny. Zainstaluj GitHub CLI i wykonaj jednorazowo `gh auth login` na swoim komputerze. Następnie sprawdzaj aktualizacje w Ratchecie.');
    }
  }
  if(!response.ok)throw Error(`Serwer aktualizacji: HTTP ${response.status}`);
  if(Number(response.headers.get('content-length')||0)>limit)throw Error('Zbyt duży plik aktualizacji');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>limit)throw Error('Zbyt duży plik aktualizacji');
  return bytes;
}
async function checkUpdate(){
  const raw=await fetchBytes(MANIFEST,64000);
  const manifest=validateManifest(JSON.parse(raw.toString('utf8')));
  const available=compareVersion(manifest.version,CURRENT_VERSION)>0;
  if(available && !manifest.files.length)throw Error('Nowa wersja nie zawiera plików');
  return {...manifest,available,current:CURRENT_VERSION};
}
async function stageUpdate(manifest){
  const checked=validateManifest(manifest);
  if(compareVersion(checked.version,CURRENT_VERSION)<=0)throw Error('Brak nowszej wersji');
  if(!checked.files.length)throw Error('Brak plików aktualizacji');
  if(checked.files.length>=100&&!checked.files.some(f=>f.path===INSTALLED_MANIFEST))throw Error('Za dużo plików wydania');
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-verified-'));
  try{
    for(const f of checked.files){
      const url=BASE+'/releases/v'+checked.version+'/'+f.path.split('/').map(encodeURIComponent).join('/');
      const data=await fetchBytes(url);
      if(sha256(data)!==f.sha256)throw Error('Suma kontrolna nie zgadza się: '+f.path);
      const target=path.join(stage,...f.path.split('/'));
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,data);
    }
    // Release file may include a prebuilt ledger for legacy clients. Otherwise
    // stage a local ledger for modern clients; never overwrite a verified file.
    const prebuilt=checked.files.some(f=>f.path===INSTALLED_MANIFEST);
    if(prebuilt){
      const ledger=JSON.parse(fs.readFileSync(path.join(stage,INSTALLED_MANIFEST),'utf8'));
      if(ledger.version!==checked.version||!Array.isArray(ledger.files))throw Error('Niespójny manifest lokalny');
      const expected=checked.files.filter(f=>f.path!==INSTALLED_MANIFEST);
      if(ledger.files.length!==expected.length||
          expected.some(f=>!ledger.files.some(g=>g.path===f.path&&g.sha256===f.sha256))) {
        throw Error('Manifest lokalny nie odpowiada plikom wydania');
      }
    }else{
      const ledger={version:checked.version,source:'ratchet-updates/latest.json',files:checked.files};
      fs.writeFileSync(path.join(stage,INSTALLED_MANIFEST),JSON.stringify(ledger,null,2),'utf8');
    }
    fs.writeFileSync(path.join(stage,'ratchet-update-list.json'),
      JSON.stringify([...checked.files.map(f=>f.path),...(prebuilt?[]:[INSTALLED_MANIFEST])]),'utf8');
    return stage;
  }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e;}
}
module.exports={CURRENT_VERSION,compareVersion,validateManifest,sha256,checkUpdate,stageUpdate};
