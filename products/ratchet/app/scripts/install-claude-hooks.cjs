'use strict';
const fs=require('fs');const path=require('path');const os=require('os');
const settingsPath=path.join(os.homedir(),'.claude','settings.json');
const command=`node "${path.resolve(__dirname,'claude-hook.cjs').replaceAll('"','\\"')}"`;
const events=['SessionStart','UserPromptSubmit','PreToolUse','Stop','StopFailure','Notification','SessionEnd'];
fs.mkdirSync(path.dirname(settingsPath),{recursive:true});
let settings={};
if(fs.existsSync(settingsPath)){
  try{settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));}
  catch{console.error('Nie można odczytać ~/.claude/settings.json. Niczego nie nadpisano.');process.exit(1);}
  fs.copyFileSync(settingsPath,settingsPath+'.ratchet-backup-'+Date.now());
}
settings.hooks ??={};
// Stop may wait for a guard's proof (up to 2 minutes in claude-hook.cjs); the rest answer at once.
const timeoutFor=event=>event==='Stop'?150:5;
for(const event of events){
  if(!Array.isArray(settings.hooks[event]))settings.hooks[event]=[];
  let has=false;
  for(const group of settings.hooks[event])for(const h of group.hooks||[]){
    // An existing Rachet hook keeps its command; only its time limit is brought up to date.
    if(String(h.command||'').includes('claude-hook.cjs')){has=true;h.timeout=timeoutFor(event);}
  }
  if(!has)settings.hooks[event].push({hooks:[{type:'command',command,timeout:timeoutFor(event)}]});
}
fs.writeFileSync(settingsPath,JSON.stringify(settings,null,2)+'\n');
console.log('Ratchet Hooks dodane do',settingsPath);
console.log('Dotychczasowe ustawienia zachowane; kopia zapasowa utworzona. Uruchom nową sesję Claude Code.');
