'use strict';
// Passes ChatGPT tab signals to Rachet on this computer only. Rachet accepts this
// one kind of message here; the extension cannot open, change or close anything.
const RACHET = 'http://127.0.0.1:47823/api/browser-signal';

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'rachet-chat' || !sender.tab) return;
  fetch(RACHET, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ratchet-Local': '1' },
    body: JSON.stringify({
      state: msg.state, url: msg.url, title: msg.title,
      visible: msg.visible === true, durationMs: Number(msg.durationMs) || 0
    })
  }).catch(() => { /* Rachet is closed: nothing to do. */ });
});
