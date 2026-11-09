# Ratchet 0.3 — wymagania produktowe (09.11.2026)

Status: wymagania użytkownika; nie oznaczają wdrożenia. Ratchet = lokalny asystent Windows: mały awatar, dyskretny panel, plan dnia, wiele sesji agentów. Cel: mniej przełączania się między narzędziami.

## P0: stabilność ZANIM dodamy nowe możliwości
- Naprawić obszar klikania tylko do widocznej kuleczki; wszystkie pozostałe piksele są click-through (issue #7).
- Jedna instancja, jeden panel, prawidłowe zamykanie także bez serwera (issue #9).
- Serwer wznawia się sam, nie wymaga otwartego Terminala; aktualizacje i rollback bez ZIP (issue #8).
- Sygnał połączenia opiera się na heartbeat, nie na kolorze static UI.
- Nie wypuszczać większych zmian bez rzeczywistego testu Windows.

## P1: powiadomienia, które prowadzą do działania
Systemowe toast Windows oraz delikatny status/dymek przy kuleczce. Działają przy zamkniętym panelu, ale sam Ratchet musi działać w tle. Nigdy nie blokują ekranu.
Źródła: zaplanowane zadania, GitHub CI/PR, Claude Code hooks, integracje z dashboardami (tylko gdy udzielono dostępu), ręcznie dodane sesje ChatGPT/Claude.
Dane alertu: identyfikator zdarzenia, projekt, typ, poziom pilności, dowody i czas weryfikacji, krótki tekst, docelowa karta/plik/folder/PR/test/sesja, przyciski: Otwórz oraz Później. Inbox przechowuje pominięte alerty.
Kliknięcie nie tworzy bez potrzeby duplikatu: gdy użytkownik jest JUŻ na właściwej karcie — wskazówka inline bez otwierania nowego okna; gdy karta istnieje w tle — aktywuj ją; w przeciwnym razie — otwórz głęboki link. Link niedostępny -> pokaż kontekst i bezpieczny fallback.
Po ukończeniu pracy agenta mów „Agent skończył”, a „Zweryfikowane” dopiero po dowodzie (CI/tests/merge/deploy to różne stany).
Priorytety: P0 (blokada wymagająca reakcji) natychmiast; P1 (potrzebna decyzja) pojedynczy alert; P2 (informacja) zestawienie. Dedup według zdarzenia i stanu. Domyślne ograniczenie około jednego niepilnego toastu na 5 min, łączenie alertów z jednego projektu; wyciszenie na spotkaniu i w trybie skupienia, quiet hours, konfigurowalne.
Testy akceptacyjne: panel zamknięty -> toast się wyświetla, kliknięcie aktywuje właściwą istniejącą kartę, duplikat zdarzenia -> jeden toast, 5 niskich priorytetów -> jedno zbiorcze powiadomienie, działa po restarcie, nie blokuje pulpitu.

## P1: trzy poziomy komunikacji (default Prosty)
- Prosty: bez żargonu, wyjaśnia co się dzieje, dlaczego to ważne i co kliknąć. Krótkie zdania, przycisk Pokaż szczegóły.
- Standard: przystępny język techniczny, przyczyna, konsekwencja i następny krok.
- Ekspert: nazwa gałęzi, PR, diff, statusy CI, testy, logi, SHA, techniczne szczegóły.
Poziomy zmieniają WYŁĄCZNIE sposób tłumaczenia tych samych faktów; nie mogą zmieniać pewności ani wymyślać diagnoz.
Ustawienie globalne w Ustawieniach, opcjonalnie per projekt. Dla właściciela domyślnie Prosty.
Test: ten sam błąd ma trzy poprawne reprezentacje i zawsze ten sam target.

## P1: Dodaj do Ratcheta + kontekst projektów
- One-click Dodaj do Ratcheta ze strony lub aplikacji (opcjonalne rozszerzenie Edge/Chrome), a także paste URL i wybór folderu z poziomu Ratcheta.
- Gdy to tylko URL — Ratchet ZAPISUJE skrót, tytuł, cel opisany przez użytkownika; NIE twierdzi że czyta dane dashboardu.
- Gdy istnieje API, webhook lub oficjalna integracja i autoryzacja — import metadanych, harmonogramu, zadań, statusów oraz schematu dashboardu, plus propozycja monitorowanych zdarzeń do zatwierdzenia.
- Lokalna pamięć każdego projektu: sources, capabilities, permissions, purpose, action targets, lastSync, monitoredEvents, changeHistory.
- Użytkownik widzi „Co Ratchet rozumie?”, „Co monitoruje?”, „Skąd to wie?”, „Usuń integrację”.
- Prywatne ChatGPT/Claude Web bez odpowiedniego dostępu: tylko URL i status manualny; nigdy nie udawać, że model odczytuje treść karty.

## P1: nawigacja do miejsca, a nie ogólnej aplikacji
Cel ma typ URL, existing browser tab, folder, file, Github PR, CI run, agent session lub dashboard oraz odpowiednie stable IDs, fallback.
W przeglądarce opcjonalne rozszerzenie sprawdza aktywną kartę i istniejące karty oraz przełącza bez duplikatów. Uprawnienia minimalne i zatwierdzone przez użytkownika.
Kliknięcie alertu o kodzie powinno trafić do konkretnego PR/CI; do linii kodu tylko gdy dostępny stabilny permalink; dla lokalnego folderu otwórz Explorer. Brak celu -> pokaż bezpieczny widok źródła, nie wymyślać linku.
Test: powiadomienie dotyczące aktualnie oglądanej karty nie przełącza okien ani nie tworzy duplikatu.

## P2: wykrywanie błędów i zależności między agentami
Źródła: GitHub Actions / checks, PR, logi testów/linterów, hooki Claude Code, opcjonalne lokalne worktree.
Rozróżniać: agent pracuje; agent zakończył; czeka na review; testy przeszły; testy nie przeszły; zmiana scalona; wdrożona.
PR-y zmieniające ten sam plik = potencjalne nakładanie się zmian, NIE potwierdzony merge conflict.
Każdy alert błędu: dowód, waga, repo/projekt, konkretne pliki i linki, sugestia następnej akcji, poziom pewności, ostatnia weryfikacja. Po CI failed pokaż link do logów, po CI passed milcz jeśli nie potrzeba decyzji.
Future: wygenerować handoff prompt dla kolejnego agenta z najnowszym SHA, testami i zależnościami; nie sterować arbitralnie prywatną rozmową bez autoryzacji.

## Architektura i wdrażanie
Źródła zdarzeń -> normalizacja -> model stanu i evidence -> reguły priorytetów/dedup/quiet-hours -> system powiadomień Windows + kuleczka + inbox -> resolver celów -> kontekst projektów.
Część natywna działa niezależnie od zamkniętego panelu. Zero pełnoekranowych przezroczystych warstw.
Wymagany bezpieczny mechanizm action targets: żadnego wykonywania poleceń z dowolnego URL/payload; potwierdzanie wrażliwych akcji, izolacja lokalnego API, ograniczone uprawnienia.

## Kolejność
0. P0: stabilność serwera, hitbox, jeden panel, zamykanie, aktualizacje.
1. P1: centrum powiadomień, kliknięcia, tryby priorytetów, zapis historii.
2. P1: trzy poziomy języka i domyślny Prosty.
3. P1: Dodaj URL/folder i precyzyjne przejścia, potem rozszerzenie przeglądarki.
4. P1: kontekst i monitorowanie prawdziwych źródeł (GitHub, Claude Code, plan dnia).
5. P2: diagnostyka błędów, zależności agentów, inteligentne handoff.
6. Później: rozmawianie głosem, osobowość i dodatkowa personalizacja awatara.

Powiązane blokery: #7, #8, #9.
