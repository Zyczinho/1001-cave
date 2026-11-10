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
  const HEARTBEAT_MS = 60000;   // a long answer keeps telling Rachet it is still working
  const address = () => location.href.split(/[?#]/)[0];
  let working = false, startedAt = 0, lastBusy = 0, lastBeat = 0, sentFor = '';

  const busy = () => STOP.some(selector => document.querySelector(selector));
  const send = (state, extra = {}) => {
    sentFor = address();
    try {
      chrome.runtime.sendMessage({
        type: 'rachet-chat', state, url: sentFor, title: document.title,
        visible: document.visibilityState === 'visible' && document.hasFocus(), ...extra
      });
    } catch { /* Extension reloaded or Rachet closed: ChatGPT keeps working normally. */ }
  };

  setInterval(() => {
    const now = Date.now();
    if (busy()) {
      lastBusy = now;
      if (!working) {
        working = true; startedAt = now; lastBeat = now;
        send('working');
      } else if (now - lastBeat > HEARTBEAT_MS || address() !== sentFor) {
        // A new chat gets its /c/... address only after the answer starts.
        lastBeat = now;
        send('working');
      }
    } else if (working && now - lastBusy > QUIET_MS) {
      working = false;
      send('done', { durationMs: lastBusy - startedAt });
    }
  }, 1000);

  addEventListener('pagehide', () => { if (working) send('closed'); });
})();
