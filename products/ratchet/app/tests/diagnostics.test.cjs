'use strict';
// CI gate: platform-independent contract checks; Windows workflow runs native PowerShell.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = filename => fs.readFileSync(path.join(__dirname,'..',filename),'utf8');

test('diagnostics can launch with Node and backend offline',()=>{
  const s=read('Diagnostyka-Ratchet.ps1');
  assert.match(s,/param\(\[switch\]\$Quiet\)/);
  assert.match(s,/127\.0\.0\.1:47823\/api\/ping/);
  assert.match(s,/Invoke-RestMethod[\s\S]*-TimeoutSec 2/);
  assert.match(s,/try\s*\{[\s\S]*Invoke-RestMethod[\s\S]*\}\s*catch/);
  assert.match(s,/LOCAL_ONLY_NOT_SENT/);
  assert.match(s,/ConvertTo-Json -Depth 8/);
  assert.match(s,/Get-FileHash/);
  assert.match(s,/Get-CimInstance Win32_Process/);
  assert.match(s,/launcher-error\.log/);
  assert.match(s,/diagnostics/);
  assert.doesNotMatch(s,/Invoke-WebRequest|UploadFile|Send-MailMessage|Start-RatchetBackend|Stop-Process/);
});

test('diagnostics launcher is one command, no manual prompt or Node prerequisite',()=>{
  const s=read('Diagnostyka-Ratchet.cmd');
  assert.match(s,/Diagnostyka-Ratchet.ps1/);
  assert.doesNotMatch(s,/node\s+--version|pause\s*$/im);
});

test('installer creates a separate shortcut which works without orb',()=>{
  const s=read('Instaluj-Ratchet.ps1');
  assert.match(s,/Ratchet - Diagnostyka\.lnk/);
  assert.match(s,/Diagnostyka-Ratchet\.ps1/);
});

test('launcher captures failed startup independently of UI',()=>{
  const s=read('Uruchom-Ratchet-Bez-Electron.ps1');
  assert.match(s,/catch\s*\{[\s\S]*Diagnostyka-Ratchet\.ps1[\s\S]*-Quiet/);
});

test('orb, browser menu and backend expose a fixed, local-only action',()=>{
  const orb=read('Ratchet-Kuleczka.ps1');
  const html=read('ui/panel.html');
  const panel=read('ui/panel.js');
  const bridge=read('ui/browser-bridge.js');
  const server=read('server.cjs');
  assert.match(orb,/Zdiagnozuj Ratchet/);
  assert.match(html,/data-action="diagnose"/);
  assert.match(panel,/bridge\.diagnose\(\)/);
  assert.match(bridge,/diagnostics:run/);
  assert.match(server,/if\(key==='diagnostics:run'\)/);
  assert.match(server,/if\(process\.platform!=='win32'\)/);
  assert.match(server,/path\.join\(__dirname,'Diagnostyka-Ratchet\.ps1'\)/);
  assert.doesNotMatch(server,/spawn\([^,]*data\./);
});
