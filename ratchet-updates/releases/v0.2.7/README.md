# Ratchet 0.2.7 — jedno okno, mniejszy panel, stała instalacja

Ratchet to prywatny desktopowy pomocnik dla Windows: plan dnia, szybkie linki i foldery, sesje agentów AI, statusy CI z publicznych repozytoriów GitHub. Działa lokalnie bez Electron i bez npm install. Wymaga Node.js (jest już na komputerze, na którym testowano wcześniejsze wersje Ratcheta).

## Ważne: to jest jednorazowa migracja

1. **Wyodrębnij wszystkie pliki** ZIP do nowego folderu. Nie uruchamiaj plików z widoku ZIP.
2. Zamknij stare okna panelu Ratchet (jeśli pozostały z v0.2.2).
3. Kliknij **`ZAINSTALUJ-RAZ.cmd`**. Skrypt zamknie lokalną starszą wersję, skopiuje Ratcheta do stałego folderu użytkownika i utworzy skrót `Ratchet` na Pulpicie.
4. **Od teraz uruchamiaj tylko skrót `Ratchet` na Pulpicie.** Nie uruchamiaj starego `URUCHOM-RATCHET.cmd` w folderze starej wersji.
5. Gdy potwierdzisz działanie nowej wersji, możesz usunąć stare foldery `ratchet-v0.2*` i ZIP-y, **ale nie usuwaj** `%APPDATA%\Ratchet\ratchet.json`.

Stała instalacja: `%LOCALAPPDATA%\Ratchet\app`.
Dane: `%APPDATA%\Ratchet\ratchet.json` (poza folderem aplikacji).

## Co naprawiono

- **Pojedyncza kuleczka:** nazwany mutex Windows zapobiega uruchomieniu kolejnych instancji.
- **Pojedynczy panel:** Ratchet szuka otwartego okna Edge o tytule `Ratchet`; jeśli je znajdzie, aktywuje je zamiast otwierać nowe.
- **Ochrona przed szybkim klikaniem:** limit prób tworzenia nowego okna przez 5 sekund.
- **Kompaktowe okno:** wymuszony początkowy rozmiar około 480 × 720 px (dopasowywany do ekranu), wygląd CSS oparty na wersji 0.2.1.
- **Wygodny start:** skrót Windows uruchamia panel i kuleczkę bez terminala.
- **Zamykanie:** `⋯ → Zakończ Ratchet` i osobny przycisk w Ustawieniach.
- **Przygotowany updater:** `⋯ → Sprawdź aktualizacje`, z SHA-256, kopią zapasową i restartem bez ręcznego rozpakowywania.

## Aktualizacje z prywatnego GitHuba

Kanał jest zapisany w repozytorium prywatnym `Zyczinho/1001-cave`, gałąź `ratchet-updates`, katalog `ratchet-updates/`. Nie trzeba upubliczniać repozytorium ani podawać tokenu Ratchetowi. Ratchet najpierw próbuje publiczny HTTPS, a gdy GitHub zwraca 404, korzysta z **GitHub CLI (`gh`)** i sesji, do której użytkownik zalogował się na swoim Windowsie.

- Jednorazowo: zainstaluj GitHub CLI (np. `winget install --id GitHub.cli`) i zaloguj się komendą `gh auth login`, o ile jeszcze tego nie zrobiłeś. Wybierz konto z dostępem do `Zyczinho/1001-cave`.
- Potem: **⋯ → Sprawdź aktualizacje → Zainstaluj**. Ratchet pobiera wyłącznie opublikowaną wersję z kontrolowanego kanału, sprawdza SHA-256, tworzy kopię, zatrzymuje serwer, podmienia zmodyfikowane pliki i uruchamia się ponownie.
- Obecnie kanał wskazuje bazową wersję 0.2.6, więc poprawna odpowiedź to **brak nowszej wersji**. Kolejne wersje trzeba najpierw opublikować na gałęzi `ratchet-updates`. Do tego momentu przycisk nie pobierze żadnych plików.
- Log aktualizacji: `%LOCALAPPDATA%\Ratchet\update-log.txt`.

## Aktualizacje bez GitHub CLI

Alternatywnie można w przyszłości opublikować osobny **publiczny kanał dystrybucji** bez prywatnych plików projektu. Ratchet będzie mógł wtedy korzystać z HTTPS bez logowania. Tego nie należy robić przez zmianę widoczności istniejącego prywatnego repozytorium.

## Test

1. Otwórz Ratchet ze skrótu na Pulpicie.
2. Kliknij kuleczkę 5× szybko — powinno pozostać jedno okno panelu (lub istniejące okno powinno zyskać fokus).
3. Zamknij panel `×`, po czym kliknij kuleczkę — powinno pojawić się jedno małe okno.
4. Uruchom ponownie skrót na Pulpicie — **nie** powinna powstać druga kuleczka ani drugi panel.
5. Utwórz zadanie na kilka minut później, otwórz link i sprawdź zapis po ponownym uruchomieniu.
6. Wyłącz `⋯ → Zakończ Ratchet`. Serwer `http://127.0.0.1:47823/api/ping` powinien przestać odpowiadać.

16 testów logiki Node.js przechodzi lokalnie. UI sprawdzono w Chromium w oknie 480 × 720. Natywne zachowanie okien i skrótu na Windowsie wymaga testu na komputerze użytkownika.

## Diagnostyka

Jeżeli coś się nie otwiera: `Diagnostyka-Ratchet.cmd` w `%LOCALAPPDATA%\Ratchet\app`.
Jeśli okno PowerShell się zamyka, uruchom `URUCHOM-RATCHET.cmd` z zainstalowanego folderu — pokaże ewentualny błąd.

## Projekt

1001 CAVE / Ratchet 0.2.6.

## P0: bezpieczny obszar klikania

Form.Region jest elipsą nałożoną na natywne okno WinForms, zgodną z faktycznie narysowaną kuleczką. Tylko okrąg reaguje na mysz. Jeśli ograniczenie obszaru nie uda się, kuleczka jest automatycznie ukrywana zamiast blokować pulpit. Po aktualizacji sprawdź kliknięcia w otoczeniu kuleczki (również przy skalowaniu 125/150%) i przeciąganie.

## Ikony i UX

Lokalne, spójne ikony SVG w `ui/icons.js`; podmieniono znaki Unicode przy nawigacji, zadaniach, agentach, skrótach i aktualizacjach. Interakcje wykorzystują krótkie przejścia `ease-out`; dla `prefers-reduced-motion` ograniczono ruch. Podejście oparte na wskazówkach Emila Kowalskiego dotyczących design engineering, bez dodatkowych bibliotek/fontów.

## 0.2.6 — poprawka animacji i wyglądu
- Panel startuje dopiero po kliknięciu w kuleczkę (koniec z miganiem przy uruchomieniu Ratcheta).
- Panel Edge otrzymuje pozycję i rozmiar w parametrach startowych; nie jest przenoszony po wyświetleniu.
- Kuleczka jest odświeżona: subtelny gradient, rozświetlenie, buźka, lampka statusu, double-buffering.
- Klikalna powierzchnia nadal ograniczona do koła (Form.Region), natywny test Windows pozostaje wymagany.

## 0.2.6 — zamykanie kuleczki niezależne od serwera

- Prawy przycisk myszy na kuleczce zawsze wyświetla natywne menu **Zakończ Ratchet**, nawet gdy nie działa localhost.
- Kliknięcie lewym przyciskiem podczas awarii serwera wyświetla to samo menu zamiast otwierać niedziałający panel Edge.
- Jeśli serwer odpowiadał i następnie przestanie działać przez dłuższy czas, osierocona kuleczka zamknie się automatycznie.
- Awaryjny skrót `AWARYJNIE-ZATRZYMAJ-RATCHET.cmd` wywołuje `Zatrzymaj-Ratchet.ps1` i zamyka jedynie procesy związane z Ratchetem. Nie usuwa danych.

Testy Windows wymagają potwierdzenia na komputerze użytkownika.


## Stabilizacja 0.2.7 — co naprawdę zmieniono

- **Uruchamianie bez Terminala:** `URUCHOM-RATCHET.cmd` startuje oddzielny, ukryty proces PowerShell. Po jego zamknięciu zewnętrznego okna terminala Ratchet nadal działa.
- **Samonaprawianie serwera:** proces kuleczki monitoruje localhost i wznawia Node po awarii; uruchomienia są chronione międzyprocesowym muteksem, a logi trafiają do `%LOCALAPPDATA%\Ratchet\logs`.
- **Jedno okno:** wykrywanie panelu przez rzeczywiste uchwyty okien Edge i zabezpieczenie przed równoległym uruchamianiem nowego panelu.
- **Bezpieczne zamykanie:** menu systemowej ikonki przy zegarze działa także przy awarii serwera; przywrócenie serwera jest możliwe bez instalacji.
- **Aktualizacja transakcyjna:** pobranie, weryfikacja SHA-256, kopia plików, restart, test `/api/ping`, a jeśli test nie przejdzie — wycofanie i restart poprzedniej wersji.
- **Rzetelna informacja o połączeniu:** etykieta w panelu zmienia się na `BRAK POŁĄCZENIA`, gdy lokalny serwer przestaje odpowiadać.
- **Profil:** zapisywanie tworzy `ratchet.json.bak`, a w przypadku uszkodzenia podstawowego JSON aplikacja próbuje użyć kopii zapasowej.
- Zachowany jest eliptyczny `Form.Region` kuleczki, aby niewidzialny prostokąt nie blokował pulpitu.

**Ograniczenie:** na Linuxie weryfikowano testy Node i analizę plików PowerShell. Testy zachowania natywnych okien, powiadomień i restartu na rzeczywistym Windowsie są nadal wymagane. Jest to kandydat do stabilnego wydania, a nie potwierdzona stabilność na wszystkich konfiguracjach.

### Test akceptacyjny na Windows

1. Zamknij wszystkie procesy starszego Ratcheta z natywnego menu i uruchom pojedynczy skrót `Ratchet`.
2. Zamknij dowolny Terminal. Z `http://127.0.0.1:47823/api/ping` nadal powinno być `ok:true`.
3. Kliknij kulkę 5× szybko: otworzyć powinno się tylko jedno okno.
4. Klikaj tuż obok kulki, także na przyciskach aplikacji znajdujących się pod nią: wszystkie kliknięcia muszą przechodzić.
5. W Menedżerze zadań zatrzymaj wyłącznie proces `node.exe` uruchamiający `server.cjs` Ratcheta i sprawdź, czy kuleczka wznowi serwer; nie zabijaj innych procesów Node.
6. Test lokalnego serwera i aktualizacji: przycisk `Sprawdź aktualizacje` wyświetla czytelny wynik, a restart po instalacji weryfikuje `/api/ping`.
7. Prawy klik na kuleczce → `Zakończ Ratchet`; znika kulka, zamyka się backend, nie ma `ERR_CONNECTION_REFUSED` przy ponownym uruchomieniu.
