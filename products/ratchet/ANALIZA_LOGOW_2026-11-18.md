# Rachet: analiza logów lipiec–listopad 2026 (18.11.2026)

## Źródła
- 340 sesji Claude Code (`~/.claude/projects`, 1.07–18.11), 2992 Twoje wiadomości. Wcześniejszych logów (czerwiec) na dysku nie ma.
- Dziennik Racheta `%APPDATA%\Ratchet\dziennik` (12–18.11), 1927 zdarzeń, Claude + ChatGPT.
- Liczone lokalnie, bez wysyłania treści promptów. Liczby z dopasowania słów kluczowych są przybliżone.

## Na co szedł czas
| Obszar | Sesje / wiadomości | Uwaga |
|---|---|---|
| BOX2BOX (sprzedaż, reklamy, Klaviyo, grafiki) | 297 sesji, 2222 wiadomości | 3/4 całej pracy |
| Rutyny automatyczne (Puls dnia, Kit scout, Klaviyo check, ClickUp, Audyt sklepu) | 154 sesje bez Twojej wiadomości | Kit scout 34 razy, potem wyłączony, bo nie działał |
| 1001 CAVE: City Route, Rachet, strona | 29 sesji, 481 wiadomości | najwięcej błędów narzędzi na sesję |
| AMP Media, ECOMMERCE-LAB, szukanie pracy | 13 sesji, 286 wiadomości | |

Najczęstsze tematy wiadomości: analizy sprzedaży i ruchu (329), grafiki i content (300), plan dnia / zadania (263), Klaviyo i maile (223), reklamy Meta/TikTok/Google (218). 215 wiadomości miało zrzut ekranu.

## Co się powtarza i gdzie były błędy
1. **Skakanie między agentami.** 12–18.11: 148 przełączeń projektu na 519 promptów, do 22 sesji jednego dnia (12.11). Agenci stali po skończonej pracy łącznie ok. 26 h (przerwy 5–120 min). Mediana reakcji to 1,8 min, więc problemem nie jest wolna reakcja, tylko za dużo rzeczy naraz.
2. **Mega‑sesje.** 18 rozmów miało 40+ wiadomości, kilka trwało dniami („Dzień dobry” 110 wiadomości, „Szybkie działania” 106, „Produkty komplementarne” 90 w 9 dni). Skutek: „pogubiłem się”, zjedzony limit (8.09: „wrap up zjada cały godzinny limit”).
3. **„Nie widzę zmian / stara wersja”** (ok. 45 razy): telefon, Shopify, City Route, Rachet. Zmiana była scalona, ale nie wdrożona albo cache.
4. **„Krok po kroku / co mam zrobić / gdzie kliknąć”** (ok. 50): Judge.me, Klaviyo, Supabase, Google Cloud, PayPal, publish City Route. Instrukcje rozrzucone, za długie.
5. **Korekty kierunku** („nie o to chodzi”, „Stop, odbiegamy”, „AI slop”, ok. 60): długie dyktowane prompty (10% ma ponad 1200 znaków), agent łapie zły wątek.
6. **Błędy narzędzi**: 894 błędy, 84 odmowy uprawnień, 83 przerwania. Najwięcej w sesjach konfiguracji i UI.

## Jak można było to rozwiązać
| Problem | Rozwiązanie | Stan |
|---|---|---|
| Skończony agent czeka niezauważony | Rachet sam podpowiada „Gotowe, czeka 40 min” | **zrobione w tym PR** |
| Za dużo projektów naraz | podpowiedź przy 4+ projektach w godzinę | **zrobione w tym PR** |
| Mega‑sesje | podpowiedź „nowa rozmowa od krótkiego przekazania” po 6 h i 30+ promptach; skill `przekazanie` | **zrobione w tym PR** + skill już jest |
| Praca bez przerwy od 5:00 do 23:00 | podpowiedź po 3 h bez 20‑minutowej pauzy | **zrobione w tym PR** |
| „Nie widzę zmian” | skill `wydanie` (SCALONE → WDROŻONE → ZAAKCEPTOWANE); Rachet mógłby pokazywać commit na produkcji | skill jest; w Rachecie do zrobienia |
| „Krok po kroku” | skill `konfiguracja-uslug`, jedna instrukcja w czacie | skill jest |
| Złe zrozumienie zadania | skill `start-zadania` (5‑liniowy kontrakt przed pracą) | skill jest |
| Rutyny, których nikt nie czyta | przegląd rutyn: wyłączyć te bez decyzji (np. codzienny Puls dnia → raz w tygodniu) | do decyzji |

## Ocena pomysłów (rada: pragmatyk, sceptyk, użytkownik, inżynier)
- **Podpowiedzi regułowe z dziennika** — wszyscy za. Lokalne, darmowe, testowalne, oparte na danych z Twojego dnia. Sceptyk: łatwo przesadzić z liczbą, więc maksymalnie jedna naraz, nigdy nad alertem „Potrzebuję Cię”, „Nie teraz” chowa na godzinę, bez dźwięku i bez powiadomień Windows (Twoja zasada: powiadomienie tylko „Gotowe” i „Potrzebuję Cię”).
- **AI „drugi mózg” czytający rozmowy** — sceptyk przeciw na teraz: koszt limitu, prywatność, ryzyko AI slopu (odrzuciłeś automatyczne podsumowanie 12.11). Najpierw sprawdzić, czy proste podpowiedzi realnie pomagają.
- **Usunięcie samouczka Koordynatora** — użytkownik za: 3 ekrany tekstu o funkcji, której prawie nie używasz. Koordynator zostaje zwinięty w „Sprawdź pracę agenta”.
- **Pełny scalający widok „Kolejka uwagi”** — inżynier: już istnieje jako karta „Teraz”; nie dublować.

## Co dalej (propozycja, po jednym PR)
1. Tydzień z podpowiedziami, potem przegląd: które pomogły, które „Nie teraz” klikasz najczęściej (skill `lekcja`).
2. Rachet pokazuje, czy ostatni merge jest już na produkcji (koniec „nie widzę zmian”).
3. Lista „Powtarza się” (E3 z `FEATURE_CZAS_I_POWTORZENIA.md`) z tych samych reguł co ta analiza.
