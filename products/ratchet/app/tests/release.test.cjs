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
 assert.match(read('updater.cjs'),/CURRENT_VERSION = '0\.2\.7'/);
 assert.match(read('server.cjs'),/version:'0\.2\.7'/);
 assert.match(read('ui/panel.js'),/0\.2\.7/);
});
