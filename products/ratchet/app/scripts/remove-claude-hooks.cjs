'use strict';
const fs=require('fs');const path=require('path');const os=require('os');
const settingsPath=path.join(os.homedir(),'.claude','settings.json');
if(!fs.existsSync(settingsPath)){console.log('Brak ustawień Claude.');process.exit(0);}
const settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));
if(settings.hooks)for(const name of Object.keys(settings.hooks)){
  settings.hooks[name]=(settings.hooks[name]||[]).map(group=>({...group,hooks:(group.hooks||[]).filter(h=>!String(h.command||'').includes('claude-hook.cjs'))})).filter(group=>group.hooks.length);
  if(!settings.hooks[name].length)delete settings.hooks[name];
}
fs.writeFileSync(settingsPath,JSON.stringify(settings,null,2)+'\n');
console.log('Usunięto tylko hooki Ratchet.');
