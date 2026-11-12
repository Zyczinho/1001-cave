# Rachet — funkcja: czas i powtórzenia (zgłoszenie 12.11.2026, 23:43)

## Słowa właściciela (streszczone)
Dzień 12.11: przy komputerze od 5:00 do 23:43. Cele: wysłać aplikacje do pracy, przerobić CV, ulepszyć City Route,
przeczytać materiały do pracy. Każdą rzecz zrobiłem po trochu. Najwięcej czasu zjadło:
- przeskakiwanie między agentami i pilnowanie ich,
- brak porządku i branie zbyt wielu rzeczy naraz,
- powtarzanie tych samych kroków i błędów: dokańczanie konfiguracji Supabase i Google Cloud dla City Route,
  wielokrotne poprawki promptów i kontekstu do szukania pracy, przeróbki CV.

Chcę, żeby Rachet:
1. liczył, ile czasu tracę na przerwy między zadaniami,
2. liczył, ile trwa zadanie od rozpoczęcia do zakończenia,
3. zauważał czynności, które powtarzają się między sesjami,
4. wskazywał, które z nich zamienić w skill (albo schemat, checklistę),
5. pomagał budować i audytować agentów i skille, a skille same się aktualizowały,
6. mówił wprost: „ten proces zajmuje 2 godziny, to za dużo” i „pytałeś o to 5 razy w tym tygodniu,
   za każdym razem od zera — da się szybciej”.

## Co już mamy (punkt wyjścia)
- Hooki Claude Code (`app/scripts/claude-hook.cjs`) zgłaszają start, pracę i koniec sesji, z projektem.
- Sygnały ChatGPT z wtyczki (`app/chatgpt-signal.cjs`): start i koniec odpowiedzi, karta, projekt.
- Transkrypty Claude Code leżą lokalnie w `~/.claude/projects/*/*.jsonl` (prompty właściciela, narzędzia, czas).

## Etapy

### E1 — Dziennik zdarzeń (fundament, bez UI)
Każde zdarzenie, które Rachet już widzi, dopisywać do lokalnego `events.jsonl`:
`{ts, źródło: claude|chatgpt, projekt, sesja, typ: start|praca|czeka_na_ciebie|koniec, tytuł}`.
Tylko lokalnie, bez treści promptów. Test: zdarzenia z jednego dnia odtwarzają oś czasu.

### E2 — Czas: zadania i przerwy
Z dziennika liczyć:
- **czas zadania** = od pierwszego promptu do „koniec” / zamkniętego PR,
- **czas czekania agenta na Ciebie** = od „czeka_na_ciebie” do Twojej odpowiedzi (to jest koszt pilnowania),
- **przełączenia** = ile razy w godzinie zmieniasz projekt,
- **przerwy** = okresy bez żadnej aktywności.
Widok: jedno podsumowanie dnia w panelu („Dziś: 4 projekty, 37 przełączeń, agenci czekali na Ciebie 2 h 10 min”).

### E3 — Powtórzenia
Skan transkryptów z ostatnich 7 dni: grupować prompty właściciela po temacie
(np. „Supabase”, „Google Cloud / OAuth”, „CV”, „prompt do szukania pracy”). Temat, który wraca
≥3 razy w tygodniu lub kosztuje >1 h łącznie, trafia na listę „Powtarza się” z liczbą razy i łącznym czasem.

### E4 — Propozycja skilla
Dla tematu z listy „Powtarza się” Rachet przygotowuje szkic skilla: kroki, które zadziałały, błędy,
które wróciły, i co sprawdzić na początku. Właściciel zatwierdza jednym kliknięciem; nic nie instaluje się samo.

### E5 — Audyt i aktualizacja skilli
Po każdym użyciu skilla Rachet porównuje: ile trwało, czy były te same błędy. Gdy skill nie skrócił czasu
albo pojawił się nowy błąd, proponuje poprawkę (diff) do zatwierdzenia.

## Zasady
- Prosto: domyślnie tylko podsumowanie dnia i lista „Powtarza się”. Szczegóły w ustawieniach.
- Prywatność: dane zostają na komputerze, bez wysyłania treści promptów na zewnątrz.
- Powiadomienia jak dotąd: tylko „skończone” i „potrzebuję Cię”. Raport czasu nie jest powiadomieniem.

## Pierwsze przypadki testowe (z 12.11)
- City Route: konfiguracja Supabase + Google Cloud (OAuth, Places) — ile razy i ile czasu w tygodniu.
- Szukanie pracy: poprawki promptów/kontekstu dla LLM i przeróbki CV.

## Kolejność
Po P0/P1 z `PLAN_2026-11-11.md`. Start od E1 + E2 (dają wartość bez AI), potem E3–E5.
