# Ratchet — obowiązkowy protokół pracy agentów

Ta instrukcja dotyczy `products/ratchet/**` i uzupełnia główny `AGENTS.md`.

## Priorytet

Najpierw P0: działający start, minipulpit, click-through, wyjście, aktualizacja i odzyskiwanie po błędzie. Dopiero potem P1/P2 (powiadomienia, integracje). Incydenty: [dziennik](incidents/README.md), aktualny [RAT-001](https://github.com/Zyczinho/1001-cave/issues/15).

## Kontrakt sesji debugowania (obowiązkowy)

1. Na początku pobierz stan `main`, sprawdź aktywne PR, a dla wdrożeń **trzy referencje**: branch kodu, `ratchet-updates/latest.json` i lokalna instalacja Windows. Wypisz ich wersję, SHA commita, sumy SHA-256 i ścieżki. Brak dowodu oznacz `UNKNOWN`.
2. Zapisz objaw i jeden test reprodukujący przed zmianą kodu. Wypisz hipotezę, jeden spodziewany wynik testu rozstrzygającego, potem rzeczywisty wynik.
3. Prowadź numerowane próby A1/A2 w Issue. **Dwie nieskuteczne próby tej samej klasy problemu → STOP**: nie wolno robić trzeciego patcha bez nowego logu/trace/repro i aktualizacji hipotezy.
4. Nie nazywaj sukcesem samego PR, CI w Linux, zielonego buildu Cloudflare lub samej zmiany manifestu. Posługuj się stanami z `incidents/README.md`.
5. Nie kopiuj ręcznie wybiórczo plików do tego samego numeru wydania. Jedna niezmienna paczka na wersję; release pochodzi z dokładnie określonego, zatwierdzonego SHA i ma zgodny manifest hashów.
6. Dotykasz tylko jednej przyczyny na raz i minimalnego zakresu plików. Nie uruchamiaj nowych funkcji w czasie P0.
7. Do release wymagane: Windows PowerShell 5.1 parser, natywny Windows UI smoke, test portu 47823, click orb→jeden panel, click-through, exit bez serwera, restart serwera, zachowanie danych, update+rollback.
8. Po udanej naprawie wprowadź wynik do Issue i `incidents/` wraz z dowodami i testem regresji. Końcowy opis rozróżnia `FIXED_IN_CODE`, `PUBLISHED`, `INSTALLED`, `VERIFIED_BY_USER`.

## Brak logów lub brak runnera

Zatrzymaj zgadywanie. Oznacz przyczynę CI jako `UNKNOWN` i sprawdź konto/runner/quota, zanim zmienisz aplikację. Cloudflare website CI i Ratchet Windows CI raportuj osobno.

## Bezpieczeństwo instalacji

Nie usuwaj `%APPDATA%\Ratchet\ratchet.json`, nie zabijaj zbiorczo wszystkich `node.exe` ani `powershell.exe`; używaj wyłącznie procesów Ratcheta z potwierdzoną ścieżką i CommandLine. Nie scalaj otwartego draft PR jako stabilnego wydania bez testów końcowych.

## Zero ręcznego kopiowania komend — zasada UX/diagnostyki

Podczas awarii nie przeciągaj użytkownika przez niekończące się cykle „wklej polecenie → screenshot → kolejne polecenie”. Po pierwszym rozpoznaniu potrzebny jest **jeden lokalny pakiet diagnostyczny** i read-only testy wykonywane przez Ratcheta, a gdy bezpieczny most #18 jest już dostępny, asystent powinien pobierać je bezpośrednio. Jeśli most nie istnieje, przyznaj to jawnie — nigdy nie udawaj dostępu do Windows. Najpierw dąż do niezależnej samodiagnostyki #17, potem do mostu #18. Każdą potrzebę ręcznej komendy traktuj jako sygnał luki automatyzacji i udokumentuj ją w rejestrze. Specyfikacja: `products/ratchet/DIAGNOSTICS_BRIDGE_SPEC.md`.
