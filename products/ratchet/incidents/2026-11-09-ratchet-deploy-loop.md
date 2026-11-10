# RAT-001: Ratchet 0.2.4 → 0.2.7 — pętla wdrożeniowa i brak minipulpitu

**Zdarzenie:** 9 listopada 2026  
**Audyt:** 10 listopada 2026  
**Status:** OTWARTY (P0); techniczna przyczyna błędnego wykrywania panelu zidentyfikowana, brak potwierdzenia naprawy na Windows.  
**Issue:** [#15](https://github.com/Zyczinho/1001-cave/issues/15)  
**PR stabilizacyjny:** [#14](https://github.com/Zyczinho/1001-cave/pull/14)

## Skutek i kryterium ukończenia

Wiele godzin iteracji nad startupem, aktualizacją i desktopową kuleczką; użytkownik finalnie widział kuleczkę, ale nie mógł otworzyć minipulpitu. Niektóre poprawki rozwiązywały inny etap niż objaw końcowy. Zadanie pozostaje otwarte do momentu, gdy **kliknięcie orb otworzy jeden działający minipulpit** na docelowym Windows, z potwierdzonymi hashami plików, działającym backendem i bez blokowania pulpitu.

## Chronologia na podstawie zapisów i GitHub

| Etap | Zaobserwowano / wykonano | Co z tego wynika |
| --- | --- | --- |
| 0.2.4 | `Failed to fetch`, `ERR_CONNECTION_REFUSED`, `127.0.0.1:47823/api/ping` przestawał odpowiadać | Frontend zależał od lokalnego serwera Node, którego życie było powiązane z Terminalem lub starym launcherem |
| Próby instalacji | Brak `electron.exe`, próby `npm install`, błędy pobierania 404 / PowerShell path | Mieszane były modele dystrybucji (Electron, Node, natywna kuleczka WinForms) i ścieżki katalogów |
| Orb | Duplikujące się instancje, przezroczysty hitbox przechwytujący kliknięcia, pozostająca kuleczka bez serwera i trudne zamknięcie | Potrzebne były natywny exit, region hit-test, mutex i nadzór backendu; same testy JS tego nie wykryją |
| Kod 0.2.7 | 34/34 testów Node w Linux, poprawki PowerShell 5.1 (BOM UTF-8, `Add-Type -ReferencedAssemblies`, `$PSScriptRoot`) | Testy kodu i poprawki powstawały, ale nie dowodziły poprawnego uruchomienia na komputerze |
| PR #14 | 11 commitów, 39 plików, `head e8dc571`; nadal draft/unmerged | Źródło naprawy nie jest w `main`; wdrożenie nie jest zakończone |
| Publikacja 0.2.7 | `ratchet-updates/latest.json` deklaruje 0.2.7, ale pliki release różnią się od #14 | **Release drift:** użytkownik może widzieć właściwy numer, lecz mieć starszy kod |
| Ostatni objaw | Orb działa, klik nie pokazuje panelu | `FindPanel()` szukał tytułu `Ratchet`, a sam orb też miał taki tytuł; commit `e8dc571` zmienił tytuł orb na `Ratchet Orb` |
| CI 09.11 22:14 UTC | [`windows-startup` run 42710120345](https://github.com/Zyczinho/1001-cave/actions/runs/42710120345): failure, brak kroków w odczycie API; Cloudflare Workers Build również failure | Brak dowodu Windows PASS; przyczyna failure runnera niepotwierdzona, Cloudflare nie jest testem desktopowym |

## Potwierdzone problemy architektury dostarczania

**1. Rozjechane gałęzie / źródła wersji.** `main` zawiera specyfikację, `ratchet/stability-0.2.7` — nowszy kod, a `ratchet-updates` — osobną paczkę `v0.2.7`. Taki układ może działać tylko przy mechanicznej promocji dokładnie tego samego artefaktu po testach. Tu porównanie źródeł dowodzi, że paczka nie zawiera końcowych poprawek.

**2. Wersja tekstowa nie identyfikuje buildu.** Sama wartość `0.2.7` w `latest.json` i `/api/ping` nie mówi, jaki dokładnie kod działa lokalnie. Trzeba dodać SHA commita/build ID i porównywać SHA-256 plików lokalnych z manifestem.

**3. Brak bramy natywnych testów.** 34 testy Node zaliczono w Linux. Problem dotyczy WinForms/PowerShell/Edge/Windows focus/hitbox, których te testy nie obejmowały. Docelowe testy Windows nadal nie są potwierdzone.

**4. Release opublikowano przed stabilizacją.** `latest.json` wskazuje 0.2.7 mimo nieukończonego PR #14 i braku Windows acceptance. To przedwczesne awansowanie artefaktu do `stable`.

**5. Pętla bez jednoznacznego wyjścia.** Kolejne poprawki dotyczyły serwera, launchera, instalacji i panelu. Bez pomiaru `running version/hash + backend health + window title/handle` mogliśmy korygować źródło niewidoczne w działającej instalacji. Nie było wymuszonego stopu po dwóch nieskutecznych próbach.

**6. Sygnały z różnych deploymentów.** Błędy Cloudflare Workers dotyczą strony 1001 CAVE, a nie natywnego Windows Ratcheta. Ich traktowanie jako warunku działania pulpitu prowadzi do fałszywych tropów i odwrócenia priorytetów.

## Silny mechanizm przyczynowy minipulpitu

W starszym `Ratchet-Kuleczka.ps1` kod nadaje formularzowi `$form.Text = 'Ratchet'`. `RatchetNativeWindow.FindPanel()` enumeruje okna i akceptuje okno o tytule `Ratchet`. Funkcja `Open-RatchetPanel` po znalezieniu i aktywowaniu rzekomego panelu kończy działanie, więc może aktywować **orb zamiast uruchomić Edge**. Commit [e8dc571](https://github.com/Zyczinho/1001-cave/commit/e8dc57132a444897691c230d1dd9e687220cd24a) zmienia tytuł orb na `Ratchet Orb`. Ten commit **nie znajduje się w pliku release v0.2.7**. To potwierdzony błąd kodu i wiarygodna przyczyna ostatniego objawu, ale do zamknięcia potrzebny jest Windows E2E na właściwej paczce.

## Hipotezy wymagające potwierdzenia (nie wpisywać jako fakty)

- Czy komputer ma dokładnie starszą paczkę 0.2.7, wersję 0.2.4 albo mieszankę plików (częściowy update)?
- Czy obecny skrót uruchamia `%LOCALAPPDATA%\Ratchet\app`, czy stary katalog?
- Czy problem GitHub Actions wynikał z wyczerpania minut / blokady runnera? Run ma failure i zero widocznych steps, ale log nie był dostępny; **nie znamy przyczyny**.
- Czy Cloudflare build failed przez konfigurację preview, uprawnienia czy inny problem? Nie mylić z działaniem Ratcheta Windows.

## Próby i dlaczego nie zamknęły się w czasie

| Próba (grupa) | Cel | Obserwacja | Brakujący dowód |
| --- | --- | --- | --- |
| A1: reinstalacja / inna metoda uruchamiania | Wystartować program | Błędy `electron.exe`, pakiety npm i ścieżki; częściowy sukces | Jedna kanoniczna ścieżka uruchomienia i odczyt faktycznego procesu |
| A2: backend / launcher / update | Usunąć `Failed to fetch` i zależność od Terminala | Pojawiły się poprawki nadzoru, rollbacku i logów | Kontrola `/api/ping` **po** aktualizacji i restart Windows |
| A3: orb / panel | Uruchamiać minipulpit po kliknięciu | Wykryto kolizję tytułu i poprawiono ją w `e8dc571` | Udowodniona promocja identycznego pliku do release i lokalnej instalacji |

To **grupy zmian z rekonstrukcji**, nie udokumentowane pojedyncze testy; nie przypisywać im fikcyjnych wyników ani czasów.

## Działanie zapobiegawcze: nowa ścieżka Ratchet

1. **Freeze nowego developmentu P1/P2** do zamknięcia RAT-001; nie rozwijać powiadomień podczas awarii startu.
2. Sprawdzić dokładny skrót, `CommandLine` procesu, `/api/ping`, hash instalowanych plików i tytuł okna. Jedna hipoteza na próbę.
3. Przygotować jedną wersję kandydującą z aktualnego PR (po code review). **Nadać nowy numer 0.2.8**, nie przepakowywać 0.2.7 pod tą samą etykietą.
4. Odblokować właściwy Windows CI i pozyskać wynik rzeczywiście uruchomionych kroków. Brak runnera nie jest zielonym testem.
5. Sprawdzić na Windows orb, panel, focus, single instance, click-through, quit, restart backendu, rollback i profil.
6. Dopiero wtedy opublikować w `ratchet-updates` jedną spójną paczkę z kontrolną sumą, SHA commita i wynikiem Windows.
7. Zainstalować, odczytać lokalne hashe, **kliknąć orb na komputerze użytkownika** i zamknąć RAT-001 dopiero po PASS.

## Kryterium zamknięcia i retrospektywa

**Nie zamykać**, jeśli jedynym sukcesem jest zielony `node --test`, obecność ikony, działające `/api/ping`, albo fakt, że commit poprawiający objaw istnieje w GitHubie.

**Zamknąć**, gdy identyfikator paczki i hashe na komputerze zgadzają się z wydaniem, prawdziwy Windows E2E zakończył się sukcesem i błąd otwierania panelu jest usunięty także po restarcie.

**Lekcja RAT-001:** rejestrować nie tylko „co zmieniliśmy”, ale przede wszystkim „**jaki dokładnie kod uruchomiliśmy, jakie zachowanie zaobserwowaliśmy i jaki test rozstrzygnął hipotezę**”.

## Aktualizacja diagnostyczna — 10.11.2026 (odczyt z komputera użytkownika)

Nowy **read-only PowerShell smoke** potwierdził:
- Skrót pulpitu `Ratchet.lnk` wskazuje na `%LOCALAPPDATA%\\Ratchet\\app\\Uruchom-Ratchet-Bez-Electron.ps1` (spójne z katalogiem stałej instalacji).
- Lokalny `Ratchet-Kuleczka.ps1` istnieje, ale **SHA-256 = `453A88A86B1A29DF4AA092DBABC4A20CAFB90A4F1E83B4F2EE5DA049EA692145`**.
- Manifest kanału `ratchet-updates/latest.json` dla 0.2.7 deklaruje dla `Ratchet-Kuleczka.ps1` **SHA-256 = `35cc283de5d7f94e0ae21d5c2f0c5d6eb66bcedc25b56996315814709841ecce`**. Nie są identyczne — **potwierdzony local-vs-release drift**.
- `GET http://127.0.0.1:47823/api/ping` zwrócił `{\"ok\":true,\"version\":\"0.2.7\"}` — backend działa w momencie pomiaru.
- `Select-String` po dosłownym przypisaniu `$form.Text =` nie zwrócił dopasowania. To **nie dowodzi** konkretnej implementacji ani tego, który skrypt jest uruchomiony; należy zidentyfikować proces, metodę inicjalizacji formularza i fragmenty rzeczywistego kodu lokalnego.

**Skorygowana diagnoza:** nie jest to bieżąca awaria portu 47823. Istnieje jednoznaczna rozbieżność **lokalnej kuleczki i referencyjnego pakietu 0.2.7**. Wersja API `0.2.7` nie gwarantuje jednorodności instalacji. Przed jakąkolwiek reinstalacją/patchowaniem należy odczytać ścieżkę procesu orb oraz funkcje odpowiedzialne za kliknięcie i otwieranie panelu w *tym konkretnym lokalnym pliku*.

**Kolejny test bez mutacji:** lista procesów Ratcheta z `CommandLine`, odczyt linii skryptu zawierających `Open-RatchetPanel`, `FindPanel`, `panel.html`, `Text\s*=` i sprawdzenie `/api/ping` po kliknięciu. Nie zamykać RAT-001.
