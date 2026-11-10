# Ratchet ↔ ChatGPT Workspace Agents — monitorowanie prawdziwego zakończenia

**Stan: eksperymentalny PR — nieinstalowane, niewydane.** Ten adapter korzysta wyłącznie z oficjalnego [Workspace Agents API](https://developers.openai.com/workspace-agents/trigger-runs). Nie czyta prywatnych wiadomości, ciasteczek ani DOM przeglądarki ChatGPT.

## Co to zmienia?

Uruchomienie opublikowanego ChatGPT Workspace Agent przez Ratcheta zwraca identyfikator `apirun_...`. Ratchet odpytuje `GET https://api.chatgpt.com/v1/workspace_agents/{agtch_...}/runs/{apirun_...}` i pokazuje prawdziwe stany:

- `queued`: w kolejce
- `in_progress`: praca trwa
- `suspended`: czeka na działanie/zgodę (nieukończone); Ratchet wysyła pojedynczy dymek „ChatGPT czeka na Ciebie”, ale po późniejszym ukończeniu również wyśle oddzielne potwierdzenie.
- `completed`: API potwierdziło koniec uruchomienia — dymek + powiadomienie Windows + link do rozmowy
- `failed`: API potwierdziło błąd — dymek o blokadzie
- `attention`: nie można potwierdzić statusu, **nie wolno twierdzić, że zadanie jest ukończone**

**Uwaga:** `completed` dotyczy uruchomienia agenta, nie akceptacji QA, CI, wdrożenia lub tego, czy użytkownik zaakceptował rezultat.

## Czego Ratchet NIE potrafi jeszcze śledzić?

Nie ma udokumentowanego ogólnego API zdarzenia „asystent skończył odpowiedź” dla dowolnej sesji ChatGPT w przeglądarce (`chatgpt.com/c/...`), także dla zwykłej rozmowy w projekcie. API Workspace Agents dotyczy wyłącznie uruchomień opublikowanych agentów Workspace przez API. Też **nie odczytuje treści wyników agenta** — API statusu zwraca status i adres rozmowy.

Nie należy próbować automatycznie pobierać ciasteczek ChatGPT ani zgadywać zakończenia z układu strony.

## Wymagania dostępu

1. Konto/organizacja z dostępem do **Workspace Agents** i opublikowanym agentem z aktywnym kanałem API. Dostępność zależy od uprawnień workspace.
2. Identyfikator kanału agenta (`agtch_...`).
3. **Workspace Agent access token** z odpowiednimi uprawnieniami. To nie jest `OPENAI_API_KEY` z OpenAI Platform i nie jest hasłem ChatGPT. Administrator musi zezwolić na tworzenie tokenów; w ChatGPT: `Admin → Access tokens` (zakres `Workspace Agents`). [Dokumentacja tokenów](https://developers.openai.com/workspace-agents/authentication).
4. Ratchet musi działać na Windows, mieć dostęp do `api.chatgpt.com` i otrzymywać powiadomienia.

## Podłączenie w testowej sesji — bez zapisu sekretu do profilu

**Najpierw sprawdź sam interfejs, nie podając tokenu.** W zakładce Agenci zobaczysz „ChatGPT · prawdziwe statusy” z informacją „Brak tokenu”.

Jeśli masz już token Workspace Agents: otwórz Windows PowerShell, w tej samej sesji, w której uruchamiasz testowego Ratcheta, nadaj zmienną środowiskową `RATCHET_WORKSPACE_AGENT_TOKEN`. **Nie wklejaj sekretu do czatu, repozytorium, pliku `.env` w projekcie ani na screenshot.** Przykładowo możesz wprowadzić token przez monit maskujący:

```powershell
$secure = Read-Host "Workspace Agent access token" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:RATCHET_WORKSPACE_AGENT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
# W tym samym PowerShellu uruchom bezpieczny test w osobnym checkout PR.
# Po zakończeniu: Remove-Item Env:RATCHET_WORKSPACE_AGENT_TOKEN
```

Zmiennej **nie zapisujemy** w pliku `ratchet.json`. Zostaje tylko w procesach testowych i dziedziczonym środowisku; Windows nadal może ujawnić zmienne środowiskowe innym procesom z odpowiednimi uprawnieniami.

W Agenci wybierz sekcję ChatGPT, wprowadź nazwę, `agtch_...` i polecenie. Dopiero przycisk **Uruchom agenta ChatGPT i śledź wynik** i osobne potwierdzenie inicjują uruchomienie. Samo otwarcie panelu i testy UI nie wykonują żadnego zlecenia ani nie zużywają kredytów.

## Założenia niezawodności

- API host jest na stałe `https://api.chatgpt.com`; użytkownik nie może podać innego endpointu.
- Token jest wyłącznie w zmiennej środowiskowej backendu, nigdy w UI/snapshot/profilu JSON.
- `POST /trigger` wysyłane tylko po świadomym kliknięciu i zatwierdzeniu. Używa `OpenAI-Beta: workspace_agent_runs=v1` i unikalnego `Idempotency-Key`. Przy utracie odpowiedzi Ratchet NIE wysyła POST drugi raz automatycznie.
- Ratchet przechowuje jedynie nazwy, ID, statusy, linki i metadane. Nie zapisuje treści polecenia w profilu.
- Co 15 sekund odpytywany jest status aktywnych uruchomień. Dla znikających/mylonych ID i przerw w łączności nie ma fałszywego „ukończone”.
- Powiadomienie terminalne wysyłane najwyżej raz na potwierdzony status; link działa jedynie dla sprawdzonej domeny `chatgpt.com`.
- Kliknięcie „Usuń z historii” nie zatrzymuje uruchomienia po stronie ChatGPT.
- `suspended` wymaga sprawdzenia czatu/agenta; nie jest traktowane jako zakończenie.

## Testy przed wydaniem

1. `node --test products/ratchet/app/tests/chatgpt-workspace.test.cjs` — symulowane oficjalne odpowiedzi: queued/in_progress/suspended/completed/failed, brak ID, utrata sieci, spoofing ID, brak sekretów w zapisie.
2. Pełny `node --test products/ratchet/app/tests/*.test.cjs`.
3. Real Windows/PowerShell/WinForms smoke z osobnego checkout oraz sprawdzenie, że dymek otwiera wyłącznie zaufaną rozmowę.
4. Dopiero po uzyskaniu dostępu Workspace Agents: pojedyncze prawdziwe `POST /trigger`, GET statusu i próba powiadomienia. Brak realnego testu nie jest potwierdzeniem działania na koncie.
5. Rollback; nie scalamy do `main`, nie publikujemy aktualizacji bez powyższych wyników.

## Równoległy prototyp: zwykły ChatGPT przez wtyczkę MCP

W `integrations/chatgpt-mcp` dodano osobny, opcjonalny serwer MCP z narzędziami `ratchet_task_started`, `ratchet_task_completed` oraz `ratchet_task_needs_attention`. Ratchet zapisuje takie zdarzenia jako **raportowane przez agenta**, nie jako potwierdzone przez API platformy. Wtyczka działa wyłącznie po osobnym uruchomieniu i autoryzowanym podłączeniu przez Secure MCP Tunnel.

Wywołanie musi zostać **naprawdę wykonane** przez ChatGPT; nie można zakładać, że każde zakończenie odpowiedzi automatycznie wywoła plugin. Brak sygnału ≠ zakończenie zadania. Wtyczka nie czyta DOM ani cookies ChatGPT.

[Instrukcja podłączenia wtyczki](./integrations/chatgpt-mcp/README.md).

Wykonywanie zadań przez ChatGPT Work może też pozostawić audytowalny ślad w GitHub PR/CI — wtedy Ratchet monitoruje fakty GitHuba, a nie stan rozmowy.
