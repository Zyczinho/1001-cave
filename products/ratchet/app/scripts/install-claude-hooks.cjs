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
for(const event of events){
  if(!Array.isArray(settings.hooks[event]))settings.hooks[event]=[];
  const has=settings.hooks[event].some(group=>(group.hooks||[]).some(h=>String(h.command||'').includes('claude-hook.cjs')));
  if(!has)settings.hooks[event].push({hooks:[{type:'command',command,timeout:2000}]});
}
fs.writeFileSync(settingsPath,JSON.stringify(settings,null,2)+'\n');
console.log('Ratchet Hooks dodane do',settingsPath);
console.log('Dotychczasowe ustawienia zachowane; kopia zapasowa utworzona. Uruchom nową sesję Claude Code.');
