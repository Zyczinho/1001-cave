# Ratchet 0.2.7 — sprint stabilności (1001 CAVE)

Ratchet jest małym asystentem Windows: plan dnia, skróty do stron i folderów, monitoring sesji agentów oraz wybrane informacje z GitHuba. Ta wersja koncentruje się na stabilności; bez Electron i bez `npm install`. Wymagany jest lokalnie Node.js.

## Aktualizacja z wersji 0.2.4–0.2.5 (zalecana)

Jeśli Ratchet jest zainstalowany w `%LOCALAPPDATA%\Ratchet\app`, uruchom jego zwykły skrót, wybierz **Ustawienia → Sprawdź aktualizacje → Zainstaluj 0.2.7**. Kanał jest w prywatnym repozytorium `Zyczinho/1001-cave`, gałąź `ratchet-updates`. Obecna wersja aktualizatora korzysta z jednorazowego logowania do GitHub CLI (`gh auth login`) w przypadku prywatnego repo. Nie trzeba zmieniać widoczności repo ani ponownie rozpakowywać ZIP-ów.

**Ważne przy pierwszym przejściu:** stara wersja aktualizatora (0.2.4) uruchamia aktualizację według swoich dotychczasowych zasad. Test po restarcie i automatyczny rollback są częścią nowego aktualizatora 0.2.7 i działają dla kolejnych wersji. Nie zamykaj Ratcheta podczas podmiany plików. W przypadku pierwszej awarii sprawdź `%LOCALAPPDATA%\Ratchet\update-log.txt`.

Jeśli Ratchet nie jest już zainstalowany, uruchom `ZAINSTALUJ-RAZ.cmd` z kompletnego rozpakowanego katalogu. Utworzy jeden skrót na Pulpicie i zapisze aplikację w `%LOCALAPPDATA%\Ratchet\app`.

## Naprawione źródła problemów

- **Jeden panel i jedna kuleczka.** Orb ma międzyprocesowy mutex; drugie uruchomienie wysyła istniejącej instancji żądanie otwarcia panelu. Okno Edge wyszukiwane jest po faktycznych uchwytach Windows, nie wyłącznie po `Process.MainWindowHandle`.
- **Bez Terminala.** `URUCHOM-RATCHET.cmd` startuje ukryty proces niezależny od otwartego CMD. Skrót instalacyjny również uruchamia Ratcheta w tle.
- **Nadzór nad serwerem.** Kuleczka monitoruje `127.0.0.1:47823`; gdy serwer przestanie działać, próbuje go wznowić. Międzyprocesowy mutex zapobiega równoczesnemu uruchomieniu kilku serwerów.
- **Własne menu.** Prawy klik na kuleczce lub ikonie przy zegarze pozwala ją zamknąć również wtedy, gdy localhost nie działa; istnieje też opcja ponownego uruchomienia serwera.
- **Bezpieczny hitbox.** Okrągły `Form.Region` nie obejmuje niewidzialnych marginesów; przy błędzie tworzenia regionu kuleczka jest ukrywana.
- **Aktualizator z testem i rollbackiem.** Od tej wersji: SHA-256 przed zastosowaniem plików, backup, restart, sprawdzenie `/api/ping` z oczekiwanym numerem wersji oraz automatyczne przywrócenie plików przy niepowodzeniu.
- **Status offline.** Etykieta `LOKALNIE` w panelu zmienia się na `BRAK POŁĄCZENIA`, gdy zapytania do backendu przestają działać.
- **Dane użytkownika poza aplikacją.** Profil jest w `%APPDATA%\Ratchet\ratchet.json`; przy zapisie tworzona jest kopia `.bak`. Instalowanie i usuwanie katalogu aplikacji nie powinno kasować danych użytkownika.

## Testy

Automatycznie: `node --test tests/*.test.cjs` — 34 testy (logika, serwer HTTP, zapisywanie danych, autoryzacja żądań, statyczne kontrole PowerShell). Kontrola składni JS: `node --check`. Testy zostały wykonane w środowisku Linux — nie zastępują testu natywnych okien na Windowsie.

**Testy manualne Windows są obowiązkowe przed uznaniem wydania za w pełni stabilne:**

1. Uruchom Ratcheta ze skrótu, zamknij każdy otwarty Terminal. `/api/ping` nadal zwraca `ok:true` oraz `version:0.2.7`.
2. Kliknij kuleczkę szybko pięć razy: pozostaje jedno okno panelu.
3. Klikaj w pulpit, linki i przyciski tuż poza obrysem kuleczki: żadne kliknięcie nie jest przechwytywane.
4. Zamknij wyłącznie proces `node.exe` uruchamiający `server.cjs` Ratcheta: kuleczka powinna automatycznie odtworzyć serwer.
5. Zamknij panel i otwórz ponownie, a następnie przejdź do już otwartego panelu — bez migania i mnożenia okien.
6. Prawy klik na kuleczce lub ikonie obok zegara → `Zakończ Ratchet`: kula znika, a backend przestaje działać.
7. Ponowne uruchomienie zachowuje zadania i skróty; awaryjny skrypt `AWARYJNIE-ZATRZYMAJ-RATCHET.cmd` działa bez kasowania danych.

## Samodiagnostyka jednym kliknieciem (kandydat do kolejnego wydania)

**Stan: kod na galezi / PR, NIE opublikowano do stabilnego kanalu aktualizacji i NIE potwierdzono Windows E2E.**

Nowy plik `Diagnostyka-Ratchet.ps1` dziala w Windows PowerShell 5.1, nawet gdy lokalny serwer Node, orb lub panel nie odpowiada. Zbiera tylko odczyty: procesy Ratcheta, zdrowie `/api/ping`, skrot desktop, SHA-256 plikow i ostatnie logi. Nie restartuje niczego i nie wysyla danych do internetu. Nie wymaga logowania do GitHub.

Punkty uruchomienia: skrot `Ratchet - Diagnostyka` utworzony po ponownym uruchomieniu instalatora, `Diagnostyka-Ratchet.cmd` w folderze programu, menu kuleczki i panelu. Jezeli launcher rzuci wyjatek, sprobuje uruchomic diagnostyke z `-Quiet`, bez wyswietlania okna.

Raport zapisuje sie w `%LOCALAPPDATA%\Ratchet\diagnostics\<ID>\report.json` wraz z `summary.txt`. Przy zwyklym uruchomieniu podsumowanie otwiera sie w Notatniku. Logi sa lokalne i redagowane pod katem typowych sekretow oraz sciezek profilu, ale przed udostepnieniem nalezy je przejrzec; zadna automatyczna wysylka nie jest jeszcze uruchomiona. Bez lokalnego manifestu release diagnostyka pokazuje status `UNKNOWN_NO_LOCAL_MANIFEST`, a nie sugeruje, ze hash pasuje do wersji w GitHub.

To jest P0: **jeden raport zamiast serii kopiowanych komend**. Drugi etap — autoryzowana komunikacja Ratchet <-> asystent bez przeklejania wynikow — ma specyfikacje w `products/ratchet/DIAGNOSTICS_BRIDGE_SPEC.md` na PR #16 i osobne zadanie #18. Nie jest jeszcze zaimplementowany.
## Diagnostyka i odzyskiwanie

- Serwer: `http://127.0.0.1:47823/api/ping`
- Logi startu: `%LOCALAPPDATA%\Ratchet\logs\*-error.log` i `*-out.log`
- Log aktualizacji: `%LOCALAPPDATA%\Ratchet\update-log.txt`
- Log launchera: `%LOCALAPPDATA%\Ratchet\launcher-error.log`
- Kopie wersji: `%LOCALAPPDATA%\Ratchet\backup-*`
- Profil: `%APPDATA%\Ratchet\ratchet.json` i `.bak`

Nie usuwaj folderu profilu, nawet jeśli chcesz odinstalować starą aplikację. W razie awarii ustawień autostartu/Windows użyj zwykłego skrótu lub pliku `URUCHOM-RATCHET.cmd` z katalogu instalacji.

**Status wydania:** automatyczne testy zaliczone; kod opublikowany do ręcznego testu na Windowsie. Natywnego testu PowerShell/WinForms nie można uznać za zakończony na podstawie testów Node.
