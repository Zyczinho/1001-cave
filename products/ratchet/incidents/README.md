# Ratchet — dziennik incydentów i pętli naprawczych

To jest **żywy dziennik techniczny** (blog postmortem) Ratcheta w 1001 CAVE, a nie lista niewyjaśnionych patchy. Każdy istotny incydent ma własny numer RAT-XXX, wpis postmortem, GitHub Issue i dowody. Celem jest wiedzieć **co się zepsuło, dlaczego, jak to odtworzono i dlaczego poprzednie poprawki nie kończyły zadania**.

> Reguła: „naprawiono w kodzie” nie znaczy „uruchomiono w Windows”. Ratchet jest zdrowy dopiero po potwierdzonej instalacji i przejściu scenariusza użytkownika na docelowym komputerze.

## Rejestr

| ID | Data | Incydent | Status | GitHub |
| --- | --- | --- | --- | --- |
| RAT-001 | 09–10.11.2026 | [Rozjazd wersji 0.2.7, błędy startu i nieotwierający się minipulpit](2026-11-09-ratchet-deploy-loop.md) | **OTWARTY** — brak Windows E2E | [#15](https://github.com/Zyczinho/1001-cave/issues/15) |

## Zasada rejestrowania na przyszłość

1. Zgłoszenie objawu -> otwórz Issue z szablonu `Ratchet incident` (RAT-XXX). Zanotuj czas, wersję aplikacji, **ścieżkę z której startuje proces**, system, konkretny objaw i źródło dowodu. Nie zapisuj haseł ani prywatnych danych.
2. W jednym miejscu trzymaj: **hipotezę → test rozstrzygający → wynik → decyzję**. Nie edytuj tych samych plików na ślepo. Każdą próbę ponumeruj A1, A2.
3. **Po dwóch nieskutecznych próbach STOP**: odzyskaj stan znanej działającej wersji, zbierz nowy sygnał (log, reprodukcja, diff), zawęź problem. Kolejna poprawka jest dozwolona dopiero po wskazaniu przyczyny możliwej do sprawdzenia.
4. Zamknięcie Issue wymaga porównania `SHA-256 wydania` z lokalną instalacją, wyniku testu użytkownika i dowodu właściwego CI. Sam zielony `node --test` nie wystarcza.
5. Po rozwiązaniu dodaj wpis w tym katalogu, również dla częściowych porażek, i dopisz do tabeli. Wpis obowiązkowo wyjaśnia **co zapobiegłoby pętli**.

## Siedem stanów, których nie wolno mylić

`CODED` → `PR_OPEN` → `CI_WINDOWS_PASSED` → `RELEASE_PACKAGED` → `CHANNEL_PUBLISHED` → `INSTALLED_VERIFIED` → `USER_E2E_PASSED`.

- Każdy stan ma swój artefakt (SHA commita, wynik testu, SHA-256 paczki, manifest, hash plików lokalnych, zapis testu ręcznego).
- Nie przyznawaj stanu na podstawie numeru wersji wyświetlanego w panelu.
- Cloudflare Workers dotyczy strony 1001 CAVE, **nie** służy jako test Ratcheta dla Windows.

## Reguły wydania — Ratchet

- **Jeden niezmienny artifact na numer wersji**. Jeśli zmieniasz choć jeden bajt po publikacji 0.2.7, następne wydanie musi mieć nowy numer (np. 0.2.8), nie nadpisuj 0.2.7.
- Kanał `ratchet-updates` publikuje dopiero artifact z zatwierdzonego commita/testów. Należy zapisać `source commit SHA`, sumy plików i wyniki testów Windows w manifest/notes.
- Jedno stałe miejsce instalacji, jeden skrót, jedna kuleczka, jeden serwer. Ustawienia i profil są poza folderem aplikacji; nie usuwać `%APPDATA%\Ratchet\ratchet.json`.
- Najpierw offline i restart backendu, potem klik orb → panel, hitbox, exit, zapis danych; dopiero potem nowe funkcje (powiadomienia, deeplinki).

## Szablon wpisu postmortem

Każdy wpis zawiera: ID, status, skutki, dokładny objaw, oś czasu, dowody, **potwierdzone przyczyny vs hipotezy**, wykaz prób A1/A2 z wynikami, dlaczego pętla trwała, bariera zapobiegawcza, weryfikacja wydania, linki do Issue/PR i jasno sformułowane kryterium zamknięcia.

Szablon nowego Issue znajduje się w `.github/ISSUE_TEMPLATE/ratchet-incident.md`. Ścieżka dla agentów: `products/ratchet/AGENTS.md`.

**Automatyzacja:** gdy kanał CI i aplikacja będą stabilne, można dodawać zbieranie błędów do tego rejestru na podstawie zdarzeń Windows/GitHub. Aktualnie dziennik i Issue są trwałe, ale wpisy trzeba uzupełniać po incydencie; nie przedstawiamy tego jako działającego, automatycznego monitoringu.

## Docelowy cel: zero kopiuj–wklej

Do historii RAT-001 należy **koszt pracy człowieka**: manualne wykonywanie kolejnych krótkich komend, oczekiwanie na interpretację i ponowne przeklejanie wyników. Każdy podobny przebieg należy traktować jako antywzorzec i kandydat do automatycznej diagnostyki. Zamiast kolejek pojedynczych poleceń: jedno uruchomienie niezależnej diagnostyki i raport, a w przyszłości autoryzowany odczyt przez asystenta.

Spec: [samodiagnostyka i most](../DIAGNOSTICS_BRIDGE_SPEC.md); zadania: [#17 — diagnosta P0](https://github.com/Zyczinho/1001-cave/issues/17), [#18 — most asystenta P1](https://github.com/Zyczinho/1001-cave/issues/18).
