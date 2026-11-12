# Rachet — Strażnik (pilot, 12.11.2026)

## Po co
Agent mówi „gotowe”, zanim zadanie jest naprawdę skończone. Strażnik sprawdza to za Ciebie:
gdy pilnowana sesja Claude kończy odpowiedź, Rachet uruchamia **DOWÓD** zadania. Jeśli warunek
nie jest spełniony, agent dostaje wynik sprawdzenia i pracuje dalej.

## Jak działa
1. W zakładce **Agenci** przy wierszu projektu, który ma DOWÓD, jest tarcza. Kliknięcie włącza
   strażnika dla sesji tego projektu, która odezwała się ostatnio.
2. Claude kończy odpowiedź → hook `Stop` (`app/scripts/claude-hook.cjs`) czeka na Racheta (do 2 min).
3. Rachet uruchamia skrypt DOWODU (`app/straznik/*.cjs`) w folderze sesji:
   - wynik `0`: przepuszcza, strażnik sam się wyłącza, powiadomienie „Gotowe i sprawdzone”;
   - wynik `1`: odpowiada `{"decision":"block","reason":...}`, agent pracuje dalej (runda n/3);
   - po 3 rundach: przepuszcza i woła Ciebie („Potrzebuję Cię”);
   - inny wynik albo błąd skryptu: nigdy nie blokuje, tylko informuje.
4. Claude Code ma też własny bezpiecznik: najwyżej 8 odesłań z rzędu.

## DOWODY
| Strażnik | Projekt | Warunek |
|---|---|---|
| `city-route-google-photos` | `city-route-app` | Każde miejsce z `data/cities/<miasto>/places.json` ma poprawny identyfikator Google (`data/google-place-ids/<miasto>.json`, ta sama reguła co `catalogue-client.js`). Zdjęć Google nie wolno kopiować do repo. |

Stan na 12.11 (`main` City Route 62bb78c): 658 z 658 miejsc bez identyfikatora.

## Nowy DOWÓD
1. Skrypt w `app/straznik/<nazwa>.cjs`: argument = folder projektu, wynik na stdout, kod `0`/`1`/`2`.
   Tylko odczyt, bez sieci i kluczy. Leży w Rachecie, więc agent w projekcie go nie zmieni.
2. Wpis w `GUARDS` (`app/core.cjs`) i plik w `packageFiles` (`app/scripts/build-candidate.cjs`).
3. Test w `app/tests/guard.test.cjs`.

## Wymaga
Hook `Stop` z limitem 150 s w `~/.claude/settings.json` (ustawia `install-claude-hooks.cjs`; dotąd 5 s).
