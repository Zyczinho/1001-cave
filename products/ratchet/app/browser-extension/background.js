'use strict';
// Passes ChatGPT tab signals to Rachet on this computer only, and brings the tab with
// a finished chat to the front when you click its alert in Rachet. It can show a
// ChatGPT chat; it cannot read, change or close anything.
const RACHET = 'http://127.0.0.1:47823/api/';
const HEADERS = { 'Content-Type': 'application/json', 'X-Ratchet-Local': '1' };
const CHAT = /^https:\/\/chatgpt\.com\/(?:g\/g-p-[0-9a-f]{32}(?:-[A-Za-z0-9-]{1,80})?\/)?c\/([A-Za-z0-9-]{8,80})$/;
const chatId = url => (CHAT.exec(String(url || '')) || [])[1] || '';

// Find the tab that already holds this chat. Tabs are asked one by one; only tabs
// running Rachet's ChatGPT script answer, so no "read your tabs" permission is needed.
async function showChat(url) {
  const wanted = chatId(url);
  if (!wanted) return;
  for (const tab of await chrome.tabs.query({})) {
    let here = '';
    try { here = (await chrome.tabs.sendMessage(tab.id, { type: 'rachet-where' }))?.url; } catch { continue; }
    if (chatId(here) !== wanted) continue;
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

// One request stays open with Rachet; Rachet answers it the moment you click an alert.
let listening = false;
async function listen() {
  if (listening) return;
  listening = true;
  try {
    for (;;) {
      const res = await fetch(RACHET + 'browser-focus', { method: 'POST', headers: HEADERS, body: '{}' });
      if (!res.ok) break;
      const { url } = await res.json();
      if (url) await showChat(url).catch(() => { /* tab closed meanwhile */ });
      await chrome.runtime.getPlatformInfo(); // tells the browser this worker is still in use
    }
  } catch { /* Rachet is closed: a ChatGPT tab wakes this up again within 20 seconds. */ }
  listening = false;
}
chrome.runtime.onStartup.addListener(listen);
chrome.runtime.onInstalled.addListener(listen);
listen();

chrome.runtime.onMessage.addListener((msg, sender) => {
  listen();
  if (!msg || msg.type !== 'rachet-chat' || !sender.tab) return;
  fetch(RACHET + 'browser-signal', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      state: msg.state, url: msg.url, title: msg.title,
      visible: msg.visible === true, durationMs: Number(msg.durationMs) || 0, lagMs: Number(msg.lagMs) || 0
    })
  }).catch(() => { /* Rachet is closed: nothing to do. */ });
});
