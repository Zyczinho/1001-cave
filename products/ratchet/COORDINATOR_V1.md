# Ratchet Coordinator v1 — bezpieczny prototyp

**Status: Draft, nie publikować jeszcze jako aktualizacji.** Gałąź bazuje na PR #23 i nie zmienia działającego Ratcheta.

## Co działa w kodzie
- Osobna kolejka w lokalnym profilu `ratchet.json`, domyślnie **wyłączona**.
- Użytkownik wskazuje folder projektu, zadanie i drugiego wykonawcę. Nie ma automatycznej selekcji Issues/PR.
- Etap 1: Claude Code CLI w trybie `claude -p`; po rzeczywistym zakończeniu procesu i odebraniu wyniku, etap 2 otrzymuje raport z etapu 1.
- Etap 2: nowa sesja Claude Code CLI albo (opcjonalnie) Codex CLI, nie istniejąca rozmowa ChatGPT w przeglądarce.
- Do dwóch **różnych zadań** równolegle. Dwa etapy *jednego zadania* są sekwencyjne, ponieważ drugi zależy od raportu pierwszego.
- Powiadomienia Windows i dymek tylko na końcu obu etapów albo po przerwaniu. Sygnał przekazania między agentami zostaje zapisany jako `info` w historii, nie trafia do systemowych przypomnień.
- Statusy `queued/running/done/attention`, raporty agentów, ręczne ponowienie tylko raz na etap, timeout 6 minut na etap. Brak automatycznych pętli retry. Restart backendu oznacza niepewne zadanie jako wymagające uwagi.
- **X ukrywa panel**, jedyna komenda **Zakończ Ratchet** jest w menu trzech kropek. Usunięto z menu drugi przycisk ukrywania.

## Ograniczenia bezpieczeństwa i dostępu
- Domyślnie disabled: naciśnięcie `Włącz` wymaga potwierdzenia kosztu i uprawnień. Utworzenie zadania przy wyłączonym Coordinatorze jedynie zapisuje kolejkę.
- Claude: `-p --restricted --permission-mode plan --permission-prompts none --tools Read,Glob,Grep --disallowedTools mcp__* --max-budget-usd 0.35 --max-turns 6 --no-session-persistence`. Wymaga aktualnej wersji Claude Code wspierającej te flagi; starsze wersje **blokują etap**, nie dostają szerszych uprawnień. Limit USD jest szacunkiem dostawcy i może zostać przekroczony.
- Codex: `exec --sandbox read-only --ask-for-approval never --skip-git-repo-check`. Wymaga zainstalowanego, zalogowanego Codex CLI i działającego sandboxa Windows; jeśli nie działa, Ratchet zgłasza blokadę. Codex nie dostaje pełnego dostępu do repo.
- Wywołania są tworzone przez `spawn` z `shell:false`; żadnych dowolnych skryptów PowerShell, modyfikacji repo, `git push`, `merge` ani `deploy`.
- Starsze instalacje Node, aliasy `.cmd`, brak Claude/Codex w `PATH` mogą uniemożliwić uruchomienie procesu. To błąd jawny, nigdy automatyczne obejście bezpieczeństwa.
- Dostęp do lokalnego folderu i jego treści jest przekazywany wybranym dostawcom modeli zgodnie z możliwościami narzędzi. Nie wpisuj sekretów do celu zadania ani nie wskazuj katalogu z poufnymi danymi.
- NIE steruje istniejącą konwersacją ChatGPT w aplikacji ani nie przechwytuje otwartych sesji Claude. Hooki mogą jedynie dostarczać zdarzenia; sesje uruchomione przez Coordinatora są odróżnione, by nie dublować powiadomień.


## Test lokalny bez instalacji
W osobnym checkout na gałęzi `ratchet/coordinator-v1-safe-dispatch`, nie w `%LOCALAPPDATA%\Ratchet\app`:
```powershell
node --test products/ratchet/app/tests/coordinator.test.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File products/ratchet/app/tests/TESTUJ-P0-BEZPIECZNIE.ps1 -Manual
```
Uwaga: test ręczny jest w osobnym profilu i na porcie 47830. Trzeba **świadomie włączyć** Coordinator w panelu; od tego momentu uruchamiane CLI mogą zużywać limity subskrypcji/API. Najpierw przetestuj bez uruchamiania modeli (enabled=false).

## Przed wydaniem
1. Zielony pełny zestaw `node --test`, w tym testy nowego modułu i manifestu.
2. Rzeczywisty smoke Windows (PowerShell 5.1, 360×520, orb, potwierdzenia alertów, restart, brak procesów zombie, jedno Quit).
3. Test z **faktycznie zainstalowanym** CLI Claude Code i, jeśli używany, Codex CLI: dwie recenzje, przekazanie raportu, limit kosztów, brak zapisów w repo i poprawny fail-closed dla niezalogowanego CLI.
4. Test ręczny odmowy, timeout, przerwania procesu i restartu.
5. Dopiero potem nowa wersja i spójny manifest (nie nadpisywać istniejącego 0.2.9 RC; rollback zachowany). Żadnego merge/deploy bez walidacji.
