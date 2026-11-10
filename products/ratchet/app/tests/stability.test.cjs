'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const exists=p=>fs.existsSync(path.join(__dirname,'..',p));

test('no console launcher scripts remain that could open a visible terminal',()=>{
  for(const old of ['URUCHOM-RATCHET.cmd','ZAINSTALUJ-RAZ.cmd','ZAINSTALUJ-TEST.cmd','Instaluj-Ratchet-Test.ps1','OTWORZ-TYLKO-PANEL.cmd','AWARYJNIE-ZATRZYMAJ-RATCHET.cmd','Diagnostyka-Ratchet.cmd']){
    assert.ok(!exists(old),old+' must not be shipped any more');
  }
  const installer=read('Instaluj-Ratchet.ps1');
  // Ratchet.exe starts PowerShell with CreateNoWindow: no conhost, no Windows Terminal hand-off.
  assert.match(installer,/info\.CreateNoWindow = true;/);
  assert.match(installer,/info\.UseShellExecute = false;/);
  assert.match(installer,/\/target:winexe/);
  assert.match(installer,/Set-Shortcut \(Join-Path \$desktop 'Ratchet\.lnk'\) \$launcher/);
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
  assert.match(src,/FindPanel\(\[int\[\]\]@\(\$script:panelPids\)\)/);
  assert.match(src,/panel:show/);
  assert.match(src,/TotalSeconds -lt 2/);
  assert.match(src,/panelSpawnAttempts -ge 3/);
});
test('installer rolls back if new version does not start',()=>{
  const src=read('Apply-Ratchet-Update.ps1');
  assert.match(src,/WaitForVersion \$ExpectedVersion/);
  assert.match(src,/Rollback files restored/);
  assert.match(src,/Copy-Item -LiteralPath \$previous/);
  assert.match(src,/Start-Process -FilePath 'powershell.exe'/);
  assert.match(src,/Ratchet\.exe/);
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

test('backend startup replaces any older 0.2.x server without corrupt PowerShell regex',()=>{
  const src=read('Ratchet-Backend.ps1');
  assert.ok(src.includes(String.raw`-match '^0\.2\.[0-8]$'`),'version-regex must retain closing quote and anchor');
  assert.ok(src.includes("$script:RatchetVersion = '0.2.9'"));
  assert.ok(src.includes('$existing.version -eq $script:RatchetVersion'));
  assert.equal((src.match(/function Start-RatchetBackend/g)||[]).length,1);
  assert.match(src.trimEnd(),/return \$null\r?\n\}$/,'backend script must not have extra tokens after its single function');
});
test('PowerShell updater message does not interpolate an invalid drive-style variable',()=>{
  const src=read('Apply-Ratchet-Update.ps1');
  assert.ok(src.includes('SUCCESS ${ExpectedVersion}: /api/ping confirmed'));
  assert.doesNotMatch(src,/SUCCESS \$ExpectedVersion:/);
});

test('panel window is identified by Ratchet-owned Edge process, never by title alone',()=>{
  const src=read('Ratchet-Kuleczka.ps1');
  assert.match(src,/GetWindowThreadProcessId/);
  assert.match(src,/if \(!owners\.Contains\(ownerPid\)\) return true;/);
  assert.match(src,/--user-data-dir="/);
  assert.match(src,/Ratchet\\panel-edge/);
  assert.match(src,/-notmatch '--type='/);
  const smoke=read('tests/windows-ui-smoke.ps1');
  assert.match(smoke,/RATCHET_TERMINAL_DECOY_READY/);
  assert.match(smoke,/USER_EDGE_ALREADY_RUNNING/);
});

test('panel opens as compact 360x520 companion anchored to the painted orb',()=>{
  const src=read('Ratchet-Kuleczka.ps1');
  assert.match(src,/\$script:defaultPanelWidth = 360/);
  assert.match(src,/\$script:defaultPanelHeight = 520/);
  assert.match(src,/\$orbRight = \$orbLeft \+ \$script:orbSize/);
  // Final geometry is enforced on the real HWND because Edge may restore its own placement.
  assert.match(src,/\[RatchetNativeWindow\]::Place\(\$handle,\$g\[0\],\$g\[1\],\$g\[2\],\$g\[3\]\)/);
  assert.match(src,/Save-RatchetPanelSize \$w \$h/);
  assert.doesNotMatch(src,/Min\(480,/);
  assert.doesNotMatch(src,/Min\(720,/);
  const css=read('ui/style.css');
  assert.match(css,/Compact companion window \(360 x 520\)/);
  assert.match(css,/@media \(max-width: 410px\)/);
  assert.match(css,/\.view \{ min-height: 0; padding:/);
});

test('scheduled reminders, not the user\'s own clicks, become Windows toasts',()=>{
  const orb=read('Ratchet-Kuleczka.ps1');
  assert.match(orb,/'start' \{ return 'Ratchet - początek zadania' \}/);
  assert.match(orb,/'end'   \{ return 'Ratchet - planowany koniec' \}/);
  assert.match(orb,/shownReminders\.Contains/);
  assert.match(read('server.cjs'),/activity\('Rozpoczęto: '\+item\.title,'reminder',item\.id,'started'\)/);
});
