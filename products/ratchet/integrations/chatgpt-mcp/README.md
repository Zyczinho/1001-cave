# Ratchet ChatGPT MCP Signals — eksperymentalna prywatna wtyczka

**Status:** kod eksperymentalny, PR #25, nieinstalowane. Korzystaj z testowej kopii Ratcheta; nigdy z działającej produkcyjnej instalacji bez osobnego testu.

## Co robi
Trzy narzędzia dla ChatGPT (po świadomym podłączeniu wtyczki):

- `ratchet_task_started(title,client_key,conversation_url?)` rejestruje rozpoczęcie zadania i zwraca `id`.
- `ratchet_task_completed(id,summary?,conversation_url?)` oznacza, że **agent zgłasza** ukończenie; Ratchet pokazuje dymek z linkiem do konwersacji, jeśli model przekazał prawidłowy URL.
- `ratchet_task_needs_attention(id,reason,conversation_url?)` zgłasza blokadę.

**To NIE jest natywny sygnał zakończenia tury ChatGPT.** ChatGPT musi rzeczywiście wywołać narzędzie, np. na podstawie Twojego polecenia. Nie gwarantujemy sygnału po każdej odpowiedzi, nie podsłuchujemy okna ChatGPT i nie czytamy historii/cookies.

Sygnały z tej wtyczki Ratchet oznacza `ChatGPT · sygnały z wtyczki` (raportowane przez model), **oddzielnie** od statusów Workspace Agent potwierdzanych oficjalnym API.

## Architektura i bezpieczeństwo
```
ChatGPT (za zgodą użytkownika i po zainstalowaniu wtyczki)
  ↓ narzędzie MCP przez Secure MCP Tunnel
OpenAI tunnel-client (uruchomiony lokalnie)
  ↓ HTTP do 127.0.0.1:<port MCP>
Ratchet MCP signal plugin (osobny proces Node; port 47891)
  ↓ POST 127.0.0.1:<port backend Ratchet>/api/action
Ratchet — lokalny dziennik zadań i natywny dymek
```

- MCP plugin binduje tylko `127.0.0.1`. Nie wystawia publicznego HTTP, nie podaje ciasteczek ani sekretów ChatGPT i odrzuca żądania z nagłówkiem `Origin`.
- Wymaga jawnego `RATCHET_API_BASE=http://127.0.0.1:47832` (przykład). Nie wybiera automatycznie domyślnej produkcyjnej instalacji.
- Normalizacja nie pozwala na obce linki; `conversation_url` jest opcjonalny i musi być `https://chatgpt.com/c/...`.
- `client_key` pozwala wywołać `start` ponownie bez duplikowania zadania. `completed` powtórzone dla tego samego `id` nie wysyła kolejnego powiadomienia.
- Nie ma narzędzia do uruchamiania skryptów, edycji repo, scalania PR, wysyłania innych wiadomości ani przejmowania sesji.

## Prerekwizyty do prawdziwego testu

1. Zainstalowany Node.js oraz **osobny testowy Ratchet** z PR #25.
2. `cd products/ratchet/integrations/chatgpt-mcp`, następnie świadomie `npm install` (instalacja tylko zależności wtyczki, nie Windows Ratcheta).
3. W **tym samym terminalu** ustaw `RATCHET_API_BASE` na aktualny port testowej kuleczki (np. `http://127.0.0.1:47832`). Następnie `npm start`.
4. W [OpenAI Platform Tunnel Settings](https://platform.openai.com/settings) utwórz Secure MCP Tunnel, a `tunnel-client` skonfiguruj do `http://127.0.0.1:47891/mcp`. Wymaga to uprawnień Platform Tunnels, prawidłowego tokenu runtime oraz skojarzenia tunelu z odpowiednim workspace ChatGPT; wykonaj `tunnel-client doctor`.
5. W ChatGPT Plugins dodaj własny serwer MCP, wybierając Connection: Tunnel i wcześniej utworzony tunnel ID. Instalacja i zgody na narzędzia wymagają działania użytkownika.
6. Utwórz nową rozmowę z podłączoną wtyczką Ratchet. Poleć, by przed rozpoczęciem właściwego zadania wywołała `ratchet_task_started`, a po rzeczywistym zakończeniu `ratchet_task_completed` z uzyskanym `id`. Dopiero potwierdzony przez narzędzie sygnał powinien wywołać dymek.

Oficjalna dokumentacja:
- [Plugins — Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [MCP server quickstart](https://developers.openai.com/plugins/build/app-quickstart)

## Przed wydaniem
- Test `node --test products/ratchet/app/tests/chatgpt-signals.test.cjs` i pełny suite Node.
- Test samych narzędzi przez MCP Inspector na `127.0.0.1:47891/mcp` przed podłączaniem ChatGPT.
- Rzeczywisty test Windows, dymek, bez zdublowanych alertów, restart, przełączanie portów oraz rozłączenie wtyczki.
- Nie testować na produkcyjnym backendzie; nie deployować publicznie bez OAuth/mTLS i audytu dostępu.
