# Ratchet — samodiagnostyka i most z asystentem (brief 10.11.2026)

**Status: plan produktu, nie działająca integracja.**  
Ścieżka: lokalny ratchet → automatyczny odczyt stanu → uporządkowany raport → (po autoryzacji) asystent → ewentualnie kolejny test → naprawa za zgodą.

## Problem, który funkcja ma eliminować

Użytkownik nie powinien kopiować komend PowerShell z czatu, uruchamiać ich ręcznie, robić zrzutów i wklejać wyników. Jeśli Ratchet byłby już gotowy, awaria `orb → panel` powinna trafić bezpośrednio do lokalnego diagnosta i asystenta. Po stronie użytkownika powinna zostać **decyzja, nie praca operatorska**.

Obecna wersja `Diagnostyka-Ratchet.cmd` robi tylko kilka prostych kontroli (Node, obecność plików, ping, jeden stary log) i zatrzymuje się na `pause`; nie zbiera holistycznego raportu ani niczego nie przekazuje do asystenta. To jest istotna luka produktu.

## Faza 0 — awaryjny diagnosta poza głównym Ratchetem (#17, P0)

Niezależny od Node/backendu/orb, zgodny z Windows PowerShell 5.1, uruchamiany ikoną `Diagnozuj Ratchet` oraz automatycznie przy błędzie launchera. **Pierwsza wersja wyłącznie do odczytu**, bez restartów, zmian i usuwania. Ma tworzyć lokalny plik `report.json` i `summary.txt`.

Zbiera: bieżący SHA-256 plików vs manifest, wersję API, ścieżkę skrótu i procesu, obecność oraz stan kuleczki, `/api/ping`, logi startu i serwera, błędy PowerShell, znane okna i procesy, datę i kontekst incydentu. W danych udostępnianych na zewnątrz usuwa nazwy profilu, tokeny, sekrety i niepotrzebne ścieżki. Działa, gdy backend jest offline.

Zapisuje raport w lokalnym dzienniku zdarzeń. Przy braku uprawnienia do wysłania danych nie wysyła ich.

## Faza 1 — bezpieczny most Ratchet ↔ asystent (#18, P1)

Warstwa integracyjna udostępnia asystentowi **realne narzędzia** (np. dedykowane MCP/connector albo własny asystent podpięty do API, nie „magiczne” pisanie do prywatnej karty ChatGPT). Operacje:

| Tool | Efekt | Domyślne uprawnienie |
| --- | --- | --- |
| `ratchet.get_status` | Port, backend, orb, panel, wersje, hash, ostatni błąd | Odczyt po autoryzacji |
| `ratchet.get_incident(id)` | Raport z dowodami dla incydentu | Odczyt po autoryzacji |
| `ratchet.run_readonly_check(type)` | Jedna z kilku audytowanych kontroli z allowlisty | Odczyt po autoryzacji |
| `ratchet.request_fix(id, proposal)` | Propozycja zmiany z planem rollbacku | Wymaga decyzji użytkownika |
| `ratchet.apply_approved_fix(id, approval)` | Wykonanie zatwierdzonej konkretnej akcji | Osobna zgoda, audyt |

Przepływ pytań i odpowiedzi to lokalne `incidentId` i `diagnosticId`. Ratchet mówi asystentowi, co odczytał; asystent może poprosić Ratcheta o kolejny **read-only** test zamiast prosić człowieka o wklejanie komend. Bez zgody nie wysyła prywatnych logów. Brak internetu → dane pozostają lokalnie i połączenie można wznowić.

Połączenie wychodzące z komputera (bez publicznego portu), minimalne uprawnienia, szyfrowanie transmisji, odwoływanie zgód i pełna historia audytu. Niedozwolone są dowolne polecenia shell z nieufnych wiadomości.

## Faza 2 — sterowanie pętlą diagnozy

Silnik utrzymuje `incidentId`, hipotezy, identyfikatory prób i dowody. Rozróżnia `DIAGNOSING`, `CAUSE_FOUND`, `FIX_PROPOSED`, `APPROVED`, `PATCHED`, `INSTALLED`, `E2E_PASSED` oraz `UNKNOWN`. Dwie nieskuteczne próby bez nowej obserwacji → STOP; asystent prosi o nowy sygnał, a nie kolejny losowy patch.

Wyraźnie oddzielić `CI failed` od `build failed`, `frontend online` od `orb running`, `version=0.2.7` od faktycznych hashów. Nie sygnalizować zakończenia przed lokalnym E2E.

## Kryteria akceptacyjne z prawdziwego incydentu RAT-001

1. Użytkownik: „nie otwiera się minipulpit” — bez wpisania poleceń powstaje raport.
2. Ratchet identyfikuje: działający `node.exe`, brak orb w procesach, zgodny lub rozbieżny hash oraz log startu.
3. Asystent odczytuje raport i może zlecić kolejne dozwolone testy, bez kopiowania czegokolwiek.
4. Gdy orb/panel/backend nie działa — niezależny diagnosta pozostaje dostępny.
5. Zmiany wymagają zatwierdzenia i mają rollback; nic nie usuwa profilu użytkownika.
6. Test porównuje SHA wydania z lokalnymi, a finalnym dowodem jest orb→panel po restarcie na Windows.

## Priorytety i granica

**Teraz:** RAT-001 i P0 niezależna diagnostyka.  
**Po stabilizacji:** autoryzowany most do asystenta.  
**Później:** agent sam przeprowadza kilka kroków diagnostycznych bez interakcji użytkownika.  

W tym dokumencie nie ma deklaracji, że dzisiejszy ChatGPT już odczytuje stan Windows. Obecnie nie ma takiej aktywnej integracji; działa tylko GitHub i ręcznie udostępnione wyniki. Nie należy obiecywać czegoś innego.
