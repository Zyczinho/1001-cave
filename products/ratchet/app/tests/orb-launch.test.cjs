const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const text = fs.readFileSync(path.join(__dirname,'..','Ratchet-Kuleczka.ps1'),'utf8');
test('edge receives final geometry at creation in its own profile', () => {
  assert.match(text, /'--window-size=' \+ \$g\[2\] \+ ',' \+ \$g\[3\]/);
  assert.match(text, /'--window-position=' \+ \$g\[0\] \+ ',' \+ \$g\[1\]/);
  assert.match(text, /'--user-data-dir="' \+ \$script:panelProfile \+ '"'/);
  assert.match(text, /'--no-first-run'/);
});
test('no forced opening on mascot startup', () => {
  const tail=text.slice(text.lastIndexOf('$timer.Start()'));
  assert.doesNotMatch(tail, /\nOpen-RatchetPanel\s*\n/);
});
test('mascot is double-buffered', () => {
  assert.match(text, /this\.DoubleBuffered=true/);
});
test('orb region matches visual circle dimensions', () => {
  assert.match(text, /96\.0 \/ 112\.0/);
  assert.match(text, /8\.0 \/ 112\.0/);
  assert.match(text, /Rectangle\]::new\(8,8,96,96\)/);
});
