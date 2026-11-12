# Rachet — Strażnik (pilot, 12.11.2026)

## Po co
Agent mówi „gotowe”, zanim zadanie jest naprawdę skończone. Strażnik sprawdza to za Ciebie:
gdy pilnowana sesja Claude kończy odpowiedź, Rachet uruchamia **DOWÓD** zadania. Jeśli warunek
nie jest spełniony, agent dostaje wynik sprawdzenia i pracuje dalej. Koniec odpowiedzi agenta
nie jest dowodem; zaliczony test nie jest dowodem wdrożenia na produkcji.

## Jak działa
1. W zakładce **Agenci** przy wierszu projektu, który ma DOWÓD, jest tarcza. Kliknięcie proponuje
   kolejno dostępne DOWODY (pierwsze „tak” wygrywa) i włącza strażnika dla sesji tego projektu,
   która odezwała się ostatnio.
2. Claude kończy odpowiedź → hook `Stop` (`app/scripts/claude-hook.cjs`) czeka na Racheta (do 2 min).
3. Rachet uruchamia skrypt DOWODU (`app/straznik/*.cjs`) w folderze sesji. Trzy wyniki:
   - **Zweryfikowane** (kod `0`): agent kończy, strażnik sam się wyłącza, wiersz „Gotowe — zobacz · Zweryfikowane”;
   - **Niezaliczone** (kod `1`): `{"decision":"block","reason":...}`, agent pracuje dalej (runda n/maks.);
     po ostatniej rundzie agent kończy, a Rachet woła Ciebie („Potrzebuję Cię”);
   - **Nie da się zweryfikować** (inny kod, błąd, przekroczony czas): nigdy nie blokuje, nigdy nie mówi
     „Gotowe”, wiersz „Potrzebuję Cię” z powodem.
4. Każdy wynik trafia do `state.verifications` (ostatnie 30): strażnik, werdykt, czas, podsumowanie
   i dowód. Ostatnia linia skryptu `DOWOD-JSON {...}` (id przebiegu, commit, gałąź, liczniki,
   `modelTokens`, ścieżka raportu i artefaktów) zostaje w Rachecie i nie trafia do agenta.
   Powiadomienie z dowodem ma w „Ostatnich sygnałach” przycisk folderu „Otwórz dowód”.
5. Claude Code ma też własny bezpiecznik: najwyżej 8 odesłań z rzędu.

## DOWODY
| Strażnik | Projekt | Warunek | Rundy |
|---|---|---|---|
| `city-route-google-photos` | `city-route-app` | Każde miejsce z `data/cities/<miasto>/places.json` ma poprawny identyfikator Google (`data/google-place-ids/<miasto>.json`, ta sama reguła co `catalogue-client.js`). Zdjęć Google nie wolno kopiować do repo. Tylko odczyt plików. | 3 |
| `city-route-e2e` | `city-route-app` | Scenariusze użytkownika w zewnętrznym runnerze [e2e](https://github.com/e2e-inc/e2e) (City Route PR #230, `tests/e2e/route-save.e2e.ts`: zapis trasy → odświeżenie → trasa widoczna). Zweryfikowane tylko gdy `report.json` ma `status: passed`, 0 porażek, ≥1 wykonany test, ten sam commit co `HEAD` i `dirty: false`. | 2 |

Stan na 12.11: zdjęcia 658 z 658 miejsc bez identyfikatora (`main` 62bb78c); e2e na gałęzi PR #230
(c58535f) zweryfikowane 1/1 lokalnie na Windows w ok. 15 s, `modelTokens: 0`.

### `city-route-e2e` — szczegóły
- Rachet uruchamia wyłącznie stałe kroki: `node <plik>.mjs` ze skryptu `build` (tylko gdy ma dokładnie
  tę postać) i `node node_modules/e2e/dist/cli/bin.js run` z `E2E_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`.
  Nigdy komenda z tekstu agenta. Stary `.e2e/report.json` jest usuwany przed przebiegiem.
- Wymaga w folderze City Route jednorazowo: `npm install --no-save e2e@0.23.0 @e2e-dev/web@0.15.5`
  (bez tego: „nie da się zweryfikować”). Inna wersja e2e też daje „nie da się zweryfikować”.
- Niezatwierdzone zmiany, raport z innego commita, 0 testów, przerwany przebieg, zły format →
  „nie da się zweryfikować”.
- Do agenta trafiają tylko pola strukturalne (tytuł testu, plik, kod błędu, oczekiwana wartość,
  ścieżki artefaktów) oznaczone jako dane; tekst strony zaobserwowany przez test — nie.
- Bez modelu AI i bez kosztów (testy bez `agent.act`); `modelTokens` z raportu jest zapisywane.

## Nowy DOWÓD
1. Skrypt w `app/straznik/<nazwa>.cjs`: argument = folder projektu, wynik na stdout, kod `0`/`1`/`2`,
   opcjonalnie ostatnia linia `DOWOD-JSON {...}`. Leży w Rachecie, więc agent w projekcie go nie zmieni.
2. Wpis w `GUARDS` (`app/core.cjs`: `maxRounds`, `timeoutMs`, `note` o koszcie) i plik w `packageFiles`
   (`app/scripts/build-candidate.cjs`).
3. Test w `app/tests/guard.test.cjs`.

## Wymaga
Hook `Stop` z limitem 150 s w `~/.claude/settings.json` (ustawia `install-claude-hooks.cjs`).

## Dalej (poza pilotem)
Status sesji ≠ status zadania i łańcuch projekt → zadanie → sesja → PR → test → wdrożenie; kilka
DOWODÓW naraz na jedną sesję. Wrócić, gdy pilot sprawdzi się w praktyce.
