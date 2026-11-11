'use strict';
// Rachet: notices when ChatGPT finishes answering in this tab.
// It reads only whether ChatGPT's "stop" button is on screen, the tab title and the
// address. It never reads, copies or sends the text of any conversation.
(() => {
  const STOP = [
    'button[data-testid="stop-button"]',
    'button[aria-label^="Stop"]',
    'button[aria-label^="Zatrzymaj"]'
  ];
  const QUIET_MS = 3000;        // the stop button must stay gone this long to count as finished
  const HEARTBEAT_MS = 60000;   // while answering, confirm every minute (Rachet forgets after 3 min of silence)
  const address = () => location.href.split(/[?#]/)[0];
  const isChat = url => /\/c\/[A-Za-z0-9-]{8,}$/.test(url);
  const watching = () => document.visibilityState === 'visible' && document.hasFocus();
  // workingUrl is the conversation that is answering. "done" and "closed" always go
  // to it, never to whatever chat happens to be on screen at that moment.
  let working = false, startedAt = 0, lastBusy = 0, lastBeat = 0, workingUrl = '';
  // A finished chat you have not looked at yet; Rachet is told the moment you do.
  let unseenUrl = '';

  const busy = () => STOP.some(selector => document.querySelector(selector));
  const send = (state, url, extra = {}) => {
    try {
      chrome.runtime.sendMessage({
        type: 'rachet-chat', state, url, title: document.title,
        visible: watching(), ...extra
      });
    } catch { /* Extension reloaded or Rachet closed: ChatGPT keeps working normally. */ }
  };

  const tick = () => {
    const now = Date.now(), here = address();
    if (busy()) {
      lastBusy = now;
      if (!working) {
        working = true; startedAt = now; lastBeat = now; workingUrl = here; unseenUrl = '';
        send('working', here);
      } else if (here !== workingUrl) {
        // A new chat gets its /c/... address after the answer starts (same chat);
        // otherwise the user switched chats and the old one is no longer watched.
        if (isChat(workingUrl)) send('closed', workingUrl);
        workingUrl = here; lastBeat = now;
        send('working', here);
      } else if (now - lastBeat > HEARTBEAT_MS) {
        lastBeat = now;
        send('working', here);
      }
    } else if (working && now - lastBusy >= QUIET_MS) {
      working = false;
      if (here === workingUrl && !watching()) unseenUrl = workingUrl;
      // Finished on screen = done. Left for another chat = we cannot know, say closed.
      // lagMs: how long after the stop button left this message goes out.
      send(here === workingUrl ? 'done' : 'closed', workingUrl, { durationMs: lastBusy - startedAt, lagMs: now - lastBusy });
    }
  };
  // The safety net. A browser slows timers in a background tab, down to once a minute.
  setInterval(tick, 1000);

  // Page changes are not slowed: the answer streaming and the stop button leaving
  // arrive here at once, so "done" does not wait for the slow timer above.
  let confirmTimer = 0;
  new MutationObserver(() => {
    if (busy()) { tick(); return; }
    if (working && !confirmTimer) confirmTimer = setTimeout(() => { confirmTimer = 0; tick(); }, QUIET_MS);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // You came back to the finished chat: its wait is over.
  const noticed = () => {
    if (!unseenUrl || !watching() || address() !== unseenUrl) return;
    send('seen', unseenUrl);
    unseenUrl = '';
  };
  addEventListener('focus', noticed);
  document.addEventListener('visibilitychange', noticed);

  // Rachet asks "which chat is in this tab?" so a click can bring this tab forward.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg && msg.type === 'rachet-where') reply({ url: address() });
    });
  } catch { /* Extension reloaded: this tab answers again after F5. */ }
  // Wakes the extension so it keeps listening for a click in Rachet.
  const hello = () => { try { chrome.runtime.sendMessage({ type: 'rachet-hello' }); } catch { /* as above */ } };
  hello();
  setInterval(hello, 20000);

  addEventListener('pagehide', () => { if (working) send('closed', workingUrl); });
})();
