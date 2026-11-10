const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('native hit region clips transparent hitbox',()=>{
 const s=read('Ratchet-Kuleczka.ps1');
 assert.match(s,/function Set-RatchetHitRegion/);
 assert.match(s,/\$form\.Region = \$region/);
 assert.match(s,/\$form\.Add_SizeChanged/);
 assert.match(s,/\$form\.Hide\(\)/);
});
test('self-hosted icons and no external CDN',()=>{
 const html=read('ui/panel.html');
 assert.match(html,/<script src="icons.js">/);
 assert.match(read('ui/icons.js'),/ratchetHydrateIcons/);
 assert.doesNotMatch(html,/cdn\.|unpkg\.|fonts\.googleapis/);
});
test('version aligned across server + updater + panel',()=>{
 assert.match(read('updater.cjs'),/CURRENT_VERSION = '0\.2\.9'/);
 assert.match(read('server.cjs'),/version:CURRENT_VERSION/);
 assert.match(read('ui/panel.js'),/<strong>0\.2\.9<\/strong>/);
 assert.match(read('ui/panel.html'),/Ratchet 0\.2\.9 RC/);
 assert.match(read('Ratchet-Backend.ps1'),/\$script:RatchetVersion = '0\.2\.9'/);
 // No other hard-coded release number may drift behind.
 for(const f of ['server.cjs','updater.cjs','ui/panel.js','ui/panel.html','Ratchet-Backend.ps1','Ratchet-Kuleczka.ps1','Instaluj-Ratchet.ps1','Uruchom-Ratchet-Bez-Electron.ps1']){
   assert.doesNotMatch(read(f),/0\.2\.8['"]/,f+' still references 0.2.8');
 }
});
