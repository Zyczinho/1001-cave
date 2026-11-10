const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('left click opens native menu when localhost ping fails',()=>{
  const orb=read('Ratchet-Kuleczka.ps1');
  assert.match(orb,/function Open-RatchetPanel[\s\S]*?\/api\/ping/);
  assert.match(orb,/if \(-not \$connected\) \{[\s\S]*?orbMenu\.Show/);
});
test('right click is independently handled by orb and menu has Exit',()=>{
  const orb=read('Ratchet-Kuleczka.ps1');
  assert.match(orb,/MouseButtons\]::Right/);
  assert.match(orb,/\$menu\.Items\.Add\('Zakończ Ratchet'\)/);
  assert.match(orb,/\$form\.Close\(\)/);
});
test('orb recovers backend after crash and keeps a native exit fallback',()=>{
  const orb=read('Ratchet-Kuleczka.ps1');
  assert.match(orb,/Start-RatchetBackend/);
  assert.match(orb,/backendStartAttempts -ge 4/);
  assert.match(orb,/\$form\.Hide\(\)/);
  assert.match(orb,/\$script:notifyIcon\.Visible=\$false/);
});
test('emergency quit script targets launcher and orb, not all PowerShell processes',()=>{
  const ps=read('Zatrzymaj-Ratchet.ps1');
  assert.match(ps,/Ratchet-Kuleczka/);
  assert.match(ps,/Uruchom-Ratchet-Bez-Electron/);
  assert.match(ps,/ProcessId -ne \$PID/);
});
