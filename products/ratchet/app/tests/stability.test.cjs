'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('Windows cmd detaches launcher from Terminal lifetime',()=>{
  const src=read('URUCHOM-RATCHET.cmd');
  assert.match(src,/Start-Process -FilePath 'powershell\.exe'/);
  assert.match(src,/-WindowStyle Hidden/);
  assert.doesNotMatch(src,/call .*Uruchom-Ratchet/i);
});
test('backend recovery uses named mutex + proper health endpoint',()=>{
  const src=read('Ratchet-Backend.ps1');
  assert.match(src,/Local\\1001CAVE_RatchetBackendStart/);
  assert.match(src,/\/api\/ping/);
  assert.match(src,/Start-Process -FilePath \$node/);
  assert.match(src,/WaitOne\(2200\)/);
});
test('one orb and one panel with native HWND enumeration',()=>{
  const src=read('Ratchet-Kuleczka.ps1');
  assert.match(src,/Local\\1001CAVE_RatchetOrb/);
  assert.match(src,/EnumWindows/);
  assert.match(src,/FindPanel\(\)/);
  assert.match(src,/panel:show/);
  assert.match(src,/TotalSeconds -lt 18/);
});
test('installer rolls back if new version does not start',()=>{
  const src=read('Apply-Ratchet-Update.ps1');
  assert.match(src,/WaitForVersion \$ExpectedVersion/);
  assert.match(src,/Rollback files restored/);
  assert.match(src,/Copy-Item -LiteralPath \$previous/);
  assert.match(src,/Start-Process -FilePath 'powershell.exe'/);
});
test('server supplies target expected version to external updater',()=>{
  const src=read('server.cjs');
  assert.match(src,/'-ExpectedVersion',candidate\.version/);
});
test('panel offline state explicitly tracks request failures',()=>{
  assert.match(read('ui/browser-bridge.js'),/ratchet:connection/);
  assert.match(read('ui/panel.js'),/BRAK POŁĄCZENIA/);
  assert.match(read('ui/panel.html'),/id="backendStatus"/);
});
