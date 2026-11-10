# Ratchet 0.2.9 RC — mały pomocnik na pulpicie (1001 CAVE)

**Status: kandydat do wydania (RC). Niepublikowany w kanale stable. Stabilny dopiero po teście akceptacyjnym na komputerze użytkownika.**

Ratchet to kuleczka na pulpicie, a po kliknięciu kompaktowy panel: plan dnia z przypomnieniami o początku i planowanym końcu zadań, statusy agentów AI i GitHuba, skróty. Bez Electron i bez `npm install`; wymagany Node.js LTS i Microsoft Edge.

## Instalacja i aktualizacja

1. Rozpakuj ZIP. W środku jest **jeden folder** `Ratchet-0.2.9-RC` (nic nie trafia luzem na Pulpit).
2. Uruchom `ZAINSTALUJ RATCHET.cmd`.

Instalator (`app/Instaluj-Ratchet.ps1`):

- sprawdza SHA-256 każdego pliku z `ratchet-release-manifest.json` i kopiuje **wyłącznie** te pliki do świeżego folderu,
- zamyka starego Ratcheta z dowolnej lokalizacji (także kopie rozpakowane na Pulpicie),
- robi kopię profilu `%APPDATA%\Ratchet\ratchet.json*` i przenosi poprzedni folder programu do `%LOCALAPPDATA%\Ratchet\backups\<data>\` (niczego nie kasuje),
- kompiluje lokalnie `Ratchet.exe`, który uruchamia Ratcheta **bez okna konsoli** (`CreateNoWindow`),
- tworzy dokładnie dwa skróty na Pulpicie: `Ratchet` i `Ratchet - Diagnostyka`,
- uruchamia nową wersję i sprawdza: `/api/ping` (wersja, commit, folder), proces kuleczki, hashe zainstalowanych plików,
- jeśli cokolwiek się nie uda — **automatycznie przywraca poprzednią wersję** i ją uruchamia,
- na koniec pyta, czy przenieść pozostałości starszych wersji z Pulpitu do kopii zapasowej (tylko rozpoznane pliki Ratcheta).

Wynik: `%LOCALAPPDATA%\Ratchet\install-receipt.json` (wersja, commit, lista plików), dziennik: `%LOCALAPPDATA%\Ratchet\install.log`.

## Co zmienia 0.2.9

- **Mały panel naprawdę mały.** Panel działa w osobnym profilu Edge (`%LOCALAPPDATA%\Ratchet\panel-edge`). Wcześniej otwarty zwykły Edge przejmował okno i przywracał zapamiętane ~1050×800 px, ignorując `--window-size`. Teraz 360×520 px obok kuleczki; rozmiar ustawiony ręcznie (przeciągnięcie krawędzi) jest zapamiętywany, „Przywróć mały panel” w Ustawieniach wraca do 360×520.
- **Panel rozpoznawany po procesie**, nie po tytule: okno Terminala, PowerShella czy zwykłej karty Edge o nazwie „Ratchet” nie zostanie pomylone z panelem.
- **Bez czarnego okna.** Skróty uruchamiają `Ratchet.exe` zamiast `powershell.exe` (Windows 11 przekazywał konsolę do Windows Terminal, który ignoruje `-WindowStyle Hidden`).
- **Powiadomienia:** Windows pokazuje tylko zaplanowane przypomnienia (początek, planowany koniec) i test — nie powtarza Twoich własnych kliknięć. Ikona Ratcheta w zasobniku.
- **Kuleczka pamięta pozycję**, a ustawienia „zawsze na wierzchu” i „uruchamiaj z Windows” faktycznie działają.
- **`/api/ping` mówi, co działa:** wersja, commit, folder i PID — koniec zgadywania, która kopia jest uruchomiona.
- **Błędy kuleczki trafiają do `logs\orb.log`** zamiast udawać „serwer offline”.
- Profil zapisany z BOM (np. przez Notatnik) nie blokuje startu.

## Testy

- `node --test tests/*.test.cjs` — logika, serwer HTTP, profil, paczka RC (tylko pliki z manifestu), statyczne kontrakty PowerShell.
- `tests/windows-ui-smoke.ps1` — prawdziwe okna: kuleczka, zmiana rozmiaru na 48 px, okno-wabik „Ratchet”, panel 360×520 **przy działającym zwykłym Edge**, jeden panel, zapamiętanie rozmiaru, zamknięcie/ponowne otwarcie, brak okien konsoli, zamknięcie.
  Bezpiecznie na komputerze z działającym Ratchetem: `RATCHET_PORT=47830`, `APPDATA=<folder tymczasowy>`, `RATCHET_DISABLE_HOOKS=1`.
- Windows CI dodatkowo: instalacja z ZIP rozpakowanego obok prywatnych plików, `Ratchet.exe` bez konsoli, wycofanie zepsutej aktualizacji, nienaruszony profil, zgodność commita.

Testy automatyczne nie zastępują testu akceptacyjnego: czy użytkownik **widzi** powiadomienie Windows i czy panel jest wygodny na jego ekranie.

## Diagnostyka

Skrót `Ratchet - Diagnostyka` (lub menu kuleczki) tworzy raport tylko lokalnie: `%LOCALAPPDATA%\Ratchet\diagnostics\<ID>\`. Raport pokazuje m.in. z jakiego folderu działa backend, czy działający build zgadza się z zainstalowanym, czy Windows blokuje powiadomienia oraz czy na Pulpicie leżą pliki programu.

- Serwer: `http://127.0.0.1:47823/api/ping`
- Logi: `%LOCALAPPDATA%\Ratchet\logs\` (`*-out.log`, `*-error.log`, `orb.log`)
- Instalacja: `%LOCALAPPDATA%\Ratchet\install.log`, `install-receipt.json`
- Kopie: `%LOCALAPPDATA%\Ratchet\backups\`
- Profil (nie usuwać): `%APPDATA%\Ratchet\ratchet.json` i `.bak`
