'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(app,p),'utf8');

test('P0: status counters navigate to filters and signals are clearable',()=>{
  const js=read('ui/panel.js');
  assert.match(js,/data-action="metric"/);
  assert.match(js,/renderFilteredAgents/);
  assert.match(js,/data-action="activity-clear"/);
  assert.match(js,/data-action="activity-remove"/);
  assert.match(js,/clearActivity\(\)/);
  assert.match(js,/removeActivity\(id\)/);
});
test('P0: confirmations stay inside Ratchet panel',()=>{
  const js=read('ui/panel.js'),html=read('ui/panel.html'),css=read('ui/style.css');
  assert.doesNotMatch(js,/\b(?:window\.)?confirm\s*\(/,'native browser confirmations escape compact panel');
  assert.match(html,/id="confirmModal"/);
  assert.match(html,/role="dialog"/);
  assert.match(css,/#confirmModal\[hidden\]/);
});
test('P0: independent comic notification is region-limited and receipts are auditable',()=>{
  const native=read('Ratchet-Kuleczka.ps1');
  const server=read('server.cjs');
  assert.match(native,/\$script:speechForm\.Region\s*=/);
  assert.match(native,/Show-RatchetSpeech/);
  assert.match(native,/notification:delivery/);
  assert.match(server,/notification:status/);
  assert.match(server,/windowsAttempted:data\.windowsAttempted===true/);
  assert.match(server,/bubbleShown:data\.bubbleShown===true/);
});

test('P0: isolated launcher automatically selects free ports without shutting down live or older test instances',()=>{
  const ps=read('tests/TESTUJ-P0-BEZPIECZNIE.ps1');
  assert.match(ps,/function Find-FreeTestPort/);
  assert.match(ps,/47832\.\.47880/);
  assert.match(ps,/\$testPort=Find-FreeTestPort/);
  assert.match(ps,/\$env:RATCHET_PORT=\[string\]\$testPort/);
  assert.match(ps,/\$env:RATCHET_DISABLE_HOOKS='1'/);
  assert.doesNotMatch(ps,/Stop-Process|taskkill\.exe|kill -/i);
});
