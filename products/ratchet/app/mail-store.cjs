'use strict';
// Mailbox settings live in their own file (%APPDATA%\Ratchet\poczta.json), never in the
// panel snapshot. Passwords are encrypted with Windows DPAPI for the signed-in user, so
// the file is useless on another account or computer.
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');

function runPs(script,input){
  return new Promise((resolve,reject)=>{
    const ps=execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$in=[Console]::In.ReadToEnd();'+script],
      {windowsHide:true,timeout:20000,maxBuffer:1024*1024},(err,stdout)=>err?reject(Error('Szyfrowanie hasła w Windows nie zadziałało')):resolve(String(stdout).trim()));
    ps.stdin.end(input,'utf8');
  });
}
// Base64 in and out keeps any character of the password intact through the pipe.
const protect=plain=>runPs("$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($in.Trim()));ConvertTo-SecureString $p -AsPlainText -Force | ConvertFrom-SecureString",Buffer.from(String(plain),'utf8').toString('base64'));
const unprotect=secret=>runPs("$s=ConvertTo-SecureString $in.Trim();$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);$p=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b);[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b);[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p))",secret)
  .then(b64=>Buffer.from(b64,'base64').toString('utf8'));

class MailStore{
  constructor(dir){this.file=path.join(dir,'poczta.json');this.data={accounts:[]};this.load();}
  load(){
    try{
      const raw=JSON.parse(fs.readFileSync(this.file,'utf8').replace(/^﻿/,''));
      this.data={accounts:(Array.isArray(raw.accounts)?raw.accounts:[]).filter(a=>a&&a.email&&a.secret).slice(0,5)};
    }catch{this.data={accounts:[]};}
  }
  save(){
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2),'utf8');
    fs.renameSync(this.file+'.tmp',this.file);
  }
  get(email){return this.data.accounts.find(a=>a.email===String(email).toLowerCase());}
  upsert(account){
    const i=this.data.accounts.findIndex(a=>a.email===account.email);
    if(i>=0)this.data.accounts[i]={...this.data.accounts[i],...account};else this.data.accounts.push(account);
    this.save();
  }
  remove(email){this.data.accounts=this.data.accounts.filter(a=>a.email!==String(email).toLowerCase());this.save();}
  // What the panel may see: no secret, no message ids.
  view(){return this.data.accounts.map(a=>({email:a.email,lastCheck:a.lastCheck||'',lastError:a.lastError||'',lastChanges:(a.lastChanges||[]).slice(0,5)}));}
}
module.exports={MailStore,protect,unprotect};
