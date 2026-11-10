# Ratchet P0 — test akceptacyjny i plan bezpiecznego wdrożenia

Zakres: audyt z 10.11.2026, issue #22. Ten dokument **nie potwierdza** testu na komputerze użytkownika ani publikacji aktualizacji.

## Reguły bezpieczeństwa
- Zmiana jest rozwijana na osobnej gałęzi `ratchet/p0-audit-2026-11-10`, opartej na PR #21 (0.2.9 RC). Nie aktualizujemy `main` ani nie nadpisujemy działającej instalacji.
- Przed wydaniem zarchiwizować znany-dobry build i lokalny `%APPDATA%\Ratchet\ratchet.json`. Obecny aktualizator ma mechanizm backup/rollback; nie omijać go.
- Nie promować bez zielonych testów Node i rzeczywistego testu WinForms + Edge na Windows. CI może być zablokowane przez GitHub Actions issue #20.
- Po wydaniu zaktualizować wersję i opublikować kompletny, spójny manifest release. Nie nadpisywać istniejącego 0.2.9 RC nowym buildem pod tym samym checksumem.
- STOP po dwóch nieudanych poprawkach tego samego błędu; zapisać logi zamiast wpadać w pętlę.

## Scenariusze P0
1. Uruchom Ratchet w izolowanej sesji testowej (inny port RATCHET_PORT i profil APPDATA), nie w istniejącej instalacji. Minipulpit 360×520 otwiera się i zamyka, kuleczka nie blokuje pustego obszaru ekranu.
2. Dodaj 2 bloki dnia i wywołaj „Zakończ”. W „Ostatnich sygnałach” usuń pojedynczy wpis, następnie „Wyczyść”. Zweryfikuj: zadania i statusy przypomnień pozostały zapisane, historia jest pusta także po restarcie.
3. Kliknij każdy licznik: „Pracuje” pokazuje pracujących agentów i trwające CI; „Uwagi” pokazuje sesje oczekujące na użytkownika; „Ryzyka” pokazuje błędne CI / nakładające się PR-y z właściwymi linkami, lub pusty stan.
4. Usuń skrót i otwórz potwierdzenie zamknięcia. Mały dialog pozostaje wewnątrz Ratcheta, obsługuje Tab, Escape i Anuluj. Nie pokazuje ogromnego systemowego `confirm()`.
5. Ustawienia → Wyślij test. Serwer zwraca `queued` i ID, kuleczka wyświetla komiksowy dymek bez otwarcia panelu; po kliknięciu „Otworz” minipulpit się otwiera. Użytkownik otrzymuje potwierdzenie `bubbleShown`. Windows `ShowBalloonTip` może być wyciszony; sam `windowsAttempted` **nie jest dowodem**, że alert jest widoczny.
6. Zminimalizuj panel, wywołaj drugie powiadomienie z ikony w zasobniku. Dymek nadal jest widoczny. „Pozniej” zamyka go; przy bloku startowym przełożenie o 10 minut aktualizuje harmonogram. Dymek chowa się sam także po utracie serwera.
7. Przetestuj 48 px i 112 px kuleczkę, przeciąganie na inny monitor oraz różne skalowania DPI. Dymek musi pozostać widoczny i nie blokować obszaru poza swoim kształtem.
8. Uruchom Claude Code hook `Stop` i `StopFailure`. Dymek pokazuje „agent zakończył odpowiedź” lub błąd, **nie** twierdzi, że kod jest wdrożony; brak spamu z niezmienionego statusu.
9. Test regresji: jeden proces Ratchet, jeden panel Edge, zwijanie, ponowne otwieranie, brak konsoli, prawidłowe zatrzymywanie. Test instalatora i cofania aktualizacji na odizolowanym profilu.

## Polecenia developerskie
- Testy Node: `node --test products/ratchet/app/tests/*.test.cjs`
- Rzeczywisty Windows UI: `powershell -NoProfile -ExecutionPolicy Bypass -File products/ratchet/app/tests/windows-ui-smoke.ps1` w izolowanym profilu.
- Jeśli Windows test nie przeszedł, PR pozostaje Draft. Nie publikować aktualizacji.
