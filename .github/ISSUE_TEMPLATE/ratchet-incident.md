---
name: "Ratchet — incident / pętla naprawcza"
about: "Trwały zapis awarii, hipotez, prób i warunków zakończenia"
title: "[RAT-XXX][P0/P1] "
---

## Objaw i wpływ
Co nie działa? Co użytkownik kliknął i co faktycznie się stało?

## Środowisko i identyfikacja wersji
- Windows i PowerShell:
- Repo branch / commit SHA:
- Wersja ogłaszana w `latest.json`:
- SHA-256 plików wydania:
- Ścieżka zainstalowanego Ratcheta i skrótu:
- SHA-256 plików lokalnych:
- `http://127.0.0.1:47823/api/ping` (wynik):
- Logi (bez sekretów):
- Co **nie** zostało zweryfikowane:

## Reprodukcja przed zmianą
1. 
2. 
3. 

## Hipotezy i testy (osobne od faktów)
| Próba | Hipoteza | Test rozstrzygający | Wynik / link do dowodu | Decyzja |
| --- | --- | --- | --- | --- |
| A1 | | | | |
| A2 | | | | |

**STOP po 2 nieudanych poprawkach**. Kolejna próba wyłącznie z nowym dowodem, nową hipotezą i nowym testem reprodukującym.

## Czy wystąpił release drift?
Porównanie SHA `PR/main` ↔ `ratchet-updates` ↔ `Windows install`. Jeśli nie można sprawdzić, status **UNKNOWN**.

## Dlaczego poprzednie próby nie zadziałały?
Przyczyna pętli: zły poziom testu? nieidentyczne artefakty? brak logów? różne procesy? wąskie gardło runnera?

## Kryterium zamknięcia
- [ ] PR/commit zidentyfikowany i zatwierdzony
- [ ] Windows CI rzeczywiście wykonało kroki, PASS
- [ ] Release z unikalnym numerem, manifest i hash zgodne
- [ ] Lokalna instalacja potwierdzona hashami i ścieżką
- [ ] Windows orb → jeden działający minipulpit, click-through, exit, restart, profil
- [ ] Wynik po restarcie komputera; dowód lub relacja testera
- [ ] Wpis w `products/ratchet/incidents/` + test regresji

## Linki
PR / commit / CI run / log / postmortem:
