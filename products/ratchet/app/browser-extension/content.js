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
  // workingUrl is the conversation that is answering. "done" and "closed" always go
  // to it, never to whatever chat happens to be on screen at that moment.
  let working = false, startedAt = 0, lastBusy = 0, lastBeat = 0, workingUrl = '';

  const busy = () => STOP.some(selector => document.querySelector(selector));
  const send = (state, url, extra = {}) => {
    try {
      chrome.runtime.sendMessage({
        type: 'rachet-chat', state, url, title: document.title,
        visible: document.visibilityState === 'visible' && document.hasFocus(), ...extra
      });
    } catch { /* Extension reloaded or Rachet closed: ChatGPT keeps working normally. */ }
  };

  setInterval(() => {
    const now = Date.now(), here = address();
    if (busy()) {
      lastBusy = now;
      if (!working) {
        working = true; startedAt = now; lastBeat = now; workingUrl = here;
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
    } else if (working && now - lastBusy > QUIET_MS) {
      working = false;
      // Finished on screen = done. Left for another chat = we cannot know, say closed.
      send(here === workingUrl ? 'done' : 'closed', workingUrl, { durationMs: lastBusy - startedAt });
    }
  }, 1000);

  addEventListener('pagehide', () => { if (working) send('closed', workingUrl); });
})();
