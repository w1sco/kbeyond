<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->


---

# KBeyond

Kickbase-Liga-Analyse: rekonstruiert Kontostände, Liquidität und maximale Gebotshöhe **aller** Manager einer Liga — auch der Gegner, deren Budget Kickbase selbst nie anzeigt.

Läuft auf Next.js (App Router, JavaScript, keine TypeScript-Dateien) + Neon Postgres, deployed über Vercel unter `kbeyond.vercel.app`.

---

## Warum es dieses Projekt gibt

Kickbase zeigt jedem Manager nur den **eigenen** Kontostand. Von Gegnern sieht man Teamwert, Punkte und Kader, aber nicht, wie viel Geld sie haben.

Das Budget lässt sich aber aus dem Liga-Aktivitätsfeed rekonstruieren, weil dort jeder Kauf und Verkauf mit Preis und Managername protokolliert wird:

```
Kontostand = Startbudget
           + Login-Bonus
           + Punkte × Punkte-Bonus
           + Σ Verkaufserlöse
           − Σ Kaufpreise
           + Σ Strafen   (amt ist bereits negativ)
           + manuelle Korrektur
```

**Die Formel wird gegen den eigenen echten Kontostand kalibriert.** `/v4/leagues/{id}/me` liefert `b` — den tatsächlichen Wert des eingeloggten Nutzers. Steht die Differenz auf 0 €, ist die Formel bewiesen und gilt für alle Manager gleichermaßen. Diese Kalibrierung ist das wichtigste Werkzeug im Projekt: Sie ist der einzige harte Beweis dafür, dass die Rechnung stimmt.

**Wichtige Einschränkung dieser Kalibrierung:** Sie beweist die Formel nur für den eigenen Datensatz. Ein Fehler, der nur Gegner betrifft (fehlende Strafen, fehlende Transfers aus Zeiträumen, in denen man selbst nicht gehandelt hat), bleibt unsichtbar. Genau so wurden mehrere Bugs lange übersehen.

---

## Datenquellen: Kickbase-API (inoffiziell)

Basis-URL: `https://api.kickbase.com`
Auth: `Authorization: Bearer {token}`, Token aus dem Login.

### Bestätigt funktionierend

| Endpoint | Liefert |
|---|---|
| `POST /v4/user/login` | Body `{em, pass, loy:false}` → Token in `tkn` |
| `/v4/leagues/selection` | Eigene Ligen: `it[]` mit `i` (ID), `n`, `b` (Budget), `tv` |
| `/v4/leagues/{id}/overview` | `b` = Startbudget der Liga, `dt`, `mgc` |
| `/v4/leagues/{id}/me` | `b` = **eigener echter Kontostand** (Prüfgröße!) |
| `/v4/leagues/{id}/ranking` | `us[]`: `i`, `n`, `adm`, `sp` (Saisonpunkte), `tv`, `spl` |
| `/v4/leagues/{id}/activitiesFeed?start=&max=` | Der Feed, siehe unten |
| `/v4/leagues/{id}/players/{pid}/transferHistory` | Komplette Transferhistorie eines Spielers, bis 2020 zurück |
| `/v4/leagues/{id}/managers/{uid}/dashboard` | `tv` (Teamwert), `prft` (kumulierter Gewinn), `t` |
| `/v4/leagues/{id}/managers/{uid}/squad` | Kader mit `prc` (Kaufpreis!), `mv`, `mvgl` |
| `/v4/leagues/{id}/market` | Aktueller Transfermarkt |
| `/v4/competitions/1/table` | Alle 18 Team-IDs |
| `/v4/competitions/1/teams/{tid}/teamprofile` | Vereinskader mit Spieler-IDs |

### Bestätigt NICHT vorhanden (404/405/500)

`/managers/{uid}/transfers`, `/managers/{uid}/activities`, `/managers/{uid}/balance`,
`/leagues/{id}/finances`, `/leagues/{id}/budget`, `/users/{uid}/*`,
`/competitions/1/teams/{tid}/players`, `/competitions/1/playercenter`

Der `uid`-Parameter am `activitiesFeed` wird ignoriert.

> **Es gibt keinen Endpoint für Kontobewegungen pro Manager.** Das wurde systematisch geprüft. Nicht nochmal suchen.

---

## Der Feed und seine Event-Typen

`/v4/leagues/{id}/activitiesFeed?start={n}&max={n}` → `{ af: [...] }`

Jeder Eintrag: `i` (Event-ID), `t` (Typ), `dt` (Zeitstempel), `data` (Nutzlast).

| `t` | Bedeutung | Geldwirksam | Felder |
|---|---|---|---|
| **15** | Transfer | **ja** | `byr` Käufer, `slr` Verkäufer, `trp` Preis, `pi` Spieler-ID, `pn` Name |
| **3** | Spieler neu am Markt | nein | `pi`, `fn`, `ln`, `mv` |
| **22** | Login-Bonus | ja, aber nur eigener sichtbar | `bn` Betrag, `day` Streak-Tag |
| **26** | Meilenstein | **nein** — gibt kein Geld | `t`, `n`, `d` |
| **29** | **Strafe** (Regelverstoß) | **ja** | `amt` (negativ), `n` Managername, `adt` |

### Transfer-Logik (t=15)

Drei Varianten, eine Regel:

- Beide `byr` und `slr` → Transfer zwischen zwei Managern
- Nur `byr` (innen `t:1`) → Kauf vom Markt, Geld verlässt die Liga
- Nur `slr` (innen `t:2`) → Verkauf an Kickbase, Geld entsteht

```js
if (byr) konto[byr] -= trp;
if (slr) konto[slr] += trp;
```

Deckt alle drei Fälle ab, ohne Sonderbehandlung.

### ⚠️ Die 670er-Grenze

**Der Feed liefert nur die letzten ~670 Einträge.** Getestet in beiden Ligen: bei `start=700` kommt eine leere Liste, bei `start=600&max=100` nur 68 Ergebnisse. Beide Ligen endeten am selben Datum (8.8.), unabhängig vom jeweiligen Reset-Zeitpunkt.

Konsequenzen:
- Ligen mit länger zurückliegendem Reset haben eine **Datenlücke** zwischen Stichtag und Feed-Beginn.
- Die Datenbank ist ein **Archiv**: Was einmal importiert wurde, bleibt erhalten, auch wenn Kickbase es nicht mehr ausliefert. Regelmäßiges Aktualisieren macht die Grenze langfristig irrelevant.
- Für die Lücke der Vergangenheit gibt es zwei Teillösungen (siehe Rekonstruktion) — und einen unlösbaren Rest.

---

## Rekonstruktion: die Lücke schließen

`transferHistory` pro Spieler reicht bis 2020 zurück und umgeht damit die Feed-Grenze.

Format: `{ it: [{ u, unm, dt, trp, t }] }`
- `unm` = **Käufer** dieses Vorgangs. Fehlt `unm` → Kickbase hat gekauft.
- Der **Verkäufer** ist der Käufer des vorherigen Eintrags.
- `t: 4` mit `trp: 0` markiert den **Liga-Reset** — natürlicher Startpunkt.

### Der Spielerpool

Zwei Quellen kombiniert:
1. Alle 18 `teamprofile`-Kader (~470 Spieler), gecached in `pool_cache` für 24 h
2. **Alle Spieler-IDs, die bereits in `events` vorkommen** — erwischt Spieler, die heute in keinem Bundesliga-Kader mehr stehen

Punkt 2 wurde nachträglich ergänzt, weil ein Kauf (Baur, 8.8.) fehlte: Der Spieler war inzwischen weg, tauchte also im Kader-Pool nicht auf, war aber über sein späteres Verkaufs-Event in der Datenbank bekannt.

### Überlappungsfreiheit — wichtig!

Die Rekonstruktion schreibt **nur Transfers, die vor dem ältesten echten Feed-Eintrag liegen**:

```js
const grenze = MIN(dt) FROM events WHERE id NOT LIKE 'rk%';
const frisch = alle.filter(t => new Date(t.dt) < grenze);
```

Das ist die einzig verlässliche Duplikatvermeidung. Ein früherer Ansatz über Fingerabdrücke (Spieler + Minute) hat versagt und 88 Duplikate erzeugt, weil Feed und Historie denselben Vorgang unterschiedlich zeitstempeln können und weil ein Transfer nach dem Rekonstruktionslauf noch per Feed nachkommen kann.

**Nicht auf Fingerabdruck-Deduplizierung zurückwechseln.** Die Zeitgrenze ist robust, weil sie keine Annahmen über Zeitstempel-Gleichheit macht.

IDs rekonstruierter Einträge: `rk_{leagueId}_{playerId}_{timestamp}` — daran erkennbar und selektiv löschbar.

### Was NICHT rekonstruierbar ist

**Strafen (t=29) aus der Feed-Lücke.** Sie hängen an keinem Spieler und existieren nur im Feed. Es gibt keinen zweiten Weg — das wurde systematisch geprüft.

Der Ausweg ist organisatorisch: Der **Liga-Admin** hat Einsicht in die vollständige Historie. Man fragt ihn und trägt die Beträge als manuelle Korrektur ein. Genau so ist es in der UI beschrieben.

Ebenfalls unerreichbar: Spieler, die weder heute in einem Kader stehen noch je in den vorhandenen Events vorkamen.

> **Keine Hochrechnungen für fehlende Strafen.** Das war mal drin und wurde bewusst entfernt — es suggeriert Präzision, die nicht existiert.

---

## Der Login-Bonus

Staffelung: 10k am ersten Tag, +10k pro Tag, ab Tag 10 konstant 100k. Bei Unterbrechung Neustart bei 10k.

```js
function loginBonus(tage) {
  if (tage <= 0) return 0;
  if (tage < 10) return (tage * (tage + 1)) / 2 * 10_000;
  return 450_000 + (tage - 9) * 100_000;
}
```

### Zwei Zähler, die man nicht verwechseln darf

- `day` im Event ist der **kontoweite** Streak-Tag (gleich über alle Ligen)
- Der **Betrag** `bn` folgt einer **ligaeigenen** Staffelung, die beim Liga-Reset neu startet

Belegt durch: Liga 1 zeigte bei `day: 13` genau 20.000 €, Liga 2 bei `day: 13` volle 100.000 €. Gleicher Streak-Tag, unterschiedliche Beträge, weil die Resets unterschiedlich lange her waren.

### Gezählt werden Mitternachte, keine 24-Stunden-Blöcke

Die Gutschrift kommt um **0:00 Uhr für den neuen Tag**. Maßgeblich sind also Kalendertage
in deutscher Zeit, nicht die seit dem Startzeitpunkt verstrichene Zeit.

Eine frühere Fassung rechnete `floor((jetzt − referenz) / 24 h)`. Damit sprang der Zähler
zur Uhrzeit des Startpunkts: Bei einem Reset um 00:48 wechselte er täglich um 00:48, und
zwischen 0:00 und 0:48 stand die Rechnung einen ganzen Tag — im konstanten Bereich also
100.000 € — daneben. `tageSeit()` in `lib/format.js` zählt jetzt Mitternachte.

### Timing-Falle

Der Bonus wird um 0:00 Uhr gutgeschrieben. Lag der Liga-Reset später am selben Tag (Beispiel: 0:48), verfiel die Gutschrift für Nutzer, die vor dem Reset in der App waren. Diese Nutzer liegen dauerhaft **einen Tag** hinter der Staffelung zurück — im konstanten Bereich sind das genau 100.000 €, die sich nie mehr aufholen.

Das ist kein Fehler im Code. Es wird über eine manuelle Korrektur beim betroffenen Manager ausgeglichen.

**Nicht versuchen, den Streak-Beginn aus vorhandenen Bonus-Events abzuleiten.** Das wurde probiert und war falsch: Die frühen Gutschriften liegen typischerweise außerhalb des Feed-Fensters (sie kommen nachts, das Fenster endet mittags), also fehlt genau der Anfang, aus dem man ableiten wollte.

Steuerung über `liga_settings.login_start`. Ist das Feld leer, wird ab `stichtag` gezählt.

---

## Datenbank (Neon Postgres)

```
events(id PK, league_id, type, dt, buyer, seller, price, player_id, player_name, raw JSONB)
  + Index (league_id, dt DESC)
  IDs: Feed = Kickbase-Event-ID, Rekonstruktion = rk_{liga}_{spieler}_{ts}

liga_settings(league_id PK, stichtag, startbudget, punkte_bonus, login_aktiv, login_start, notiz)
korrektur(league_id, manager, betrag, grund)          -- PK (league_id, manager)
import_log(league_id PK, letzter_lauf, neue_events, gesamt, offset_pos, komplett)
rekon_log(league_id PK, position, fertig, letzter, gefunden)
pool_cache(id PK, daten JSONB)                        -- 'bundesliga', 24h TTL
teamwerte(league_id, manager_id, teamwert, spieler, stand)  -- PK (league_id, manager_id)
teamwert_verlauf(league_id, manager_id, teamwert, stand)   -- PK (league_id, manager_id, stand)
  + Index (league_id, manager_id, stand DESC)
markt_beobachtung(league_id, player_id, ablauf, gesehen)   -- PK (league_id, player_id, ablauf)
  + Index (league_id, player_id)
kader(league_id, manager_id, player_id, name, position, marktwert, kaufpreis, punkte, stand)
  + Index (league_id)                                 -- PK (league_id, manager_id, player_id)
```

Der Verlauf wird **nur bei echter Änderung** fortgeschrieben. Zweimal hintereinander
aktualisieren soll den Trend nicht auf 0 setzen — deshalb der bedingte Insert in
`ladeTeamwerte()`.

`initSchema()` ist idempotent und läuft bei jedem Seitenaufruf. Schemaänderungen dort ergänzen, für neue Spalten `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` verwenden.

### Einstellungen nicht überschreiben

In `app/liga/page.js` werden `startbudget` und `stichtag` mit `COALESCE` vorbelegt — nur wenn leer. **Das muss so bleiben.** Eine frühere Version hat sie bei jedem Aufruf mit `overview.b`/`overview.dt` überschrieben und damit jede manuelle Korrektur des Nutzers stillschweigend verworfen.

Übrigens: `overview.dt` ist **nicht** der Reset-Zeitpunkt. Was es genau ist, ist unklar. Der echte Reset muss manuell gesetzt werden.

---

## Frag die Liga

Auf der Ligaseite lassen sich Fragen zum Datensatz stellen („Wen muss X verkaufen, um aus
dem Minus zu kommen?"). Drei Anbieter stehen zur Wahl: Claude, ChatGPT, Gemini.

### Jeder zahlt selbst

**Der Server hat keinen eigenen API-Schlüssel.** Jeder Nutzer trägt seinen eigenen ein, er
liegt im `localStorage` des Browsers und wird bei jeder Frage mitgeschickt, einmal benutzt
und weder gespeichert noch protokolliert. Damit laufen die Kosten über den Zugang des
Fragenden und nicht über den Betreiber.

Ein serverseitiger Schlüssel als Rückfallebene wäre bequem und wurde bewusst nicht gebaut —
er würde genau die Kosten zurückholen, die hier vermieden werden sollen.

### Modellnamen werden erfragt, nicht geraten

`/api/modelle` fragt beim Anbieter, welche Modelle der Schlüssel benutzen darf. Eine fest
verdrahtete Liste wäre in wenigen Monaten falsch. Nur für Claude gibt es eine Vorauswahl
(`claude-opus-5`), sonst steht der erste Treffer der Liste.

### Der Datensatz

`baueSchnappschuss()` erzeugt Text, keine JSON-Struktur: kompakter, und das Modell muss
nichts entpacken. Enthalten sind alle Manager mit ihren Kennzahlen, die Kader und die 80
wertvollsten freien Spieler — der lange Schwanz billiger Ergänzungsspieler bringt für
Fragen nichts und kostet nur Kontext.

Bei Claude steht der Datensatz in einem eigenen `system`-Block mit `cache_control`: die
erste Frage zahlt ihn, jede weitere liest ihn zum Bruchteil. Deshalb steht die wechselnde
Frage in der Nachricht und nicht im System-Teil — sonst wäre der Zwischenspeicher bei jeder
Frage hinfällig.

### Namen sind Daten, keine Anweisungen

Manager- und Spielernamen stammen von Kickbase-Nutzern. Sie stehen zwischen klaren
Markierungen, und die Anweisung sagt ausdrücklich, dass Text, der wie eine Anweisung
aussieht, als Name zu behandeln ist.

---

## Wann kommt ein Spieler wieder auf den Markt?

Spieler kehren nach einem festen Rhythmus zurück, anfangs etwa alle 14 Tage. Der Rhythmus
verkürzt sich, je leerer der Markt wird. `/liga/markt` zeigt daraus eine Prognose je Spieler.

### Beobachtet wird das Erscheinen, nicht der Kauf

Das ist der Kern. Ein Spieler kann auf den Markt kommen, **ungekauft ablaufen** und 14 Tage
später wiederkommen und dann gekauft werden. Zwischen den beiden *Käufen* lägen 28 Tage,
der Rhythmus ist aber 14. Wer aus Kaufabständen rechnet, bekommt systematisch Vielfache.

Der Feed liefert dafür **Typ 3** („Spieler neu am Markt") — das Erscheinen selbst. Drei
Quellen laufen in eine Zeitreihe:

| Quelle | Was sie sagt |
|---|---|
| Events Typ 3 | Der Spieler ist am Markt erschienen — die beste Quelle |
| Events Typ 15 ohne `slr` | Kauf von Kickbase, der Spieler war also am Markt |
| `markt_beobachtung` | Was wir selbst beim Aktualisieren am Markt gesehen haben |

Käufe **zwischen zwei Managern** zählen nicht: die betreffen Spieler, die jemandem gehören,
und folgen nicht dem Rhythmus der freien Spieler.

Die Mitschrift ist nötig, weil der Live-Markt flüchtig ist: Ein Angebot steht rund einen
Tag, und das Feed-Fenster reicht nur ~670 Einträge zurück. Ein Angebot wird über seinen
**Ablaufzeitpunkt** identifiziert (auf die Minute gerundet, weil die Restzeit sekundenweise
läuft) — zweimal aktualisieren legt dasselbe Angebot deshalb nicht zweimal ab.

### Nur Angebote von Kickbase zählen

**Das war der Fehler, der die ersten Prognosen unbrauchbar machte.** Typ 3 feuert auch,
wenn ein *Mitspieler* einen Spieler einstellt. Solche Auftritte folgen keinem Rhythmus,
sondern der Laune des Besitzers: Wer kauft und zwei Tage später wieder anbietet, erzeugt
einen Abstand von zwei Tagen. Genug davon drücken den Median der ganzen Liga nach unten —
dann steht überall „jederzeit / überfällig", obwohl der echte Rhythmus 14 Tage ist.

Ob ein Spieler frei war, sagt der **letzte Transfer davor**: hatte er einen Käufer, lag der
Spieler in einem Kader; stand dort nur ein Verkäufer, ging er zurück an Kickbase. Auftritte
aus der ersten Gruppe fliegen raus, ihre Zahl steht im Hinweis auf der Marktseite.

Zweite Sicherung: Abstände unter zwei Tagen zählen nicht (`MINDEST_ABSTAND_TAGE`). Ein
Angebot steht rund einen Tag; alles Engere ist eine Doppelbeobachtung, kein Rhythmus.

### Beobachtungen werden zu Auftritten gebündelt

Erscheinen und Kauf desselben Angebots sind **ein** Auftritt, keine zwei. Alles, was enger
als 36 Stunden beieinanderliegt, gilt als derselbe Auftritt.

### Der Rhythmus wird laufend neu geschätzt

Median der Abstände, nicht Mittelwert — einzelne Ausreißer sollen nicht durchschlagen.
Zwei Korrekturen:

- **Nur die jüngsten Abstände** (21 Tage) zählen, solange es genug davon gibt. Der Rhythmus
  verkürzt sich mit der Zeit; ein Abstand von vor sechs Wochen beschreibt nicht das Heute.
- **Abstände über dem 1,6-fachen des Medians fliegen raus.** Sie entstehen durch Auftritte,
  die niemand mitbekommen hat — ein doppelter Abstand ist eine Datenlücke, kein doppelter
  Rhythmus.

Unter vier Abständen wird **nicht geschätzt**, sondern „Rhythmus noch unbekannt" angezeigt.

### Was nicht prognostiziert wird

- **Alles vor dem Stichtag.** Die Historie vor dem Liga-Reset sagt über den heutigen
  Rhythmus nichts.
- **Spieler, die seit dem Reset nie am Markt waren.** Die kommen in den nächsten Tagen,
  aber ohne festen Abstand — der erste Auftritt nach einem Reset folgt keinem Rhythmus.
  Dort steht „kommt demnächst", kein Datum.

---

## Diagramme

`app/liga/Verlauf.jsx` zeigt den Teamwert aller Manager über die Zeit. Was dabei zu
beachten war:

**Tagesraster statt Rohdaten.** Gespeichert wird, wenn jemand aktualisiert — bei jedem zu
einer anderen Uhrzeit. Für ein Diagramm taugt das nicht. `tagesreihen()` legt deshalb ein
festes Raster auf **0 Uhr deutscher Zeit**; der Wert eines Tages ist der letzte bekannte
Stand davor. Ohne Stand bleibt die Linie **leer statt null** — null wäre eine Aussage.

**Zwölf Linien in zwölf Farben sind unlesbar.** Alle Manager liegen zurückhaltend grau im
Hintergrund, angeklickte bekommen ihre Farbe. Die Farbe hängt fest am Manager (Reihenfolge
nach ID), **nicht an seinem Rang** — eine Auswahl darf die übrigen nicht umfärben. Mehr als
acht farbige Linien lässt die Oberfläche nicht zu, weil die geprüfte Palette acht Stufen hat.

**Zwei Geometrien.** Ein Seitenverhältnis für Desktop und Handy gibt es nicht: derselbe
`viewBox` wird auf 360 px zu einem Streifen mit unlesbarer Schrift. `useSchmal()` schaltet
per `matchMedia` um; auf dem Handy entfallen die direkten Namen am Linienende (kein Platz)
und der Tooltip steht **unter** dem Diagramm statt darüber.

**Beschriftungen entzerren.** Zwei Linien, die fast gleich enden, hätten überlappende Namen
— `entzerre()` schiebt sie auseinander. Datumsangaben am unteren Rand werden ausgedünnt und
die letzte weggelassen, wenn sie in die vorherige läuft.

Die Farben stammen aus einer geprüften kategorialen Palette (Kontrast, Farbfehlsichtigkeit,
Nachbarpaare). Drei der acht Stufen liegen unter 3:1 Kontrast — deshalb tragen die Linien
zusätzlich Namen und der Tooltip nennt sie im Klartext, die Farbe allein trägt die
Identität nicht.

**Die Achse beginnt nicht bei null.** Sonst lägen alle Linien am oberen Rand und die
täglichen Bewegungen wären unsichtbar. Das steht auch im Hinweis auf der Seite.

---

## Zugriffsschutz

Die Datenbank ist für **alle** Nutzer dieselbe: Events, Einstellungen und Korrekturen
hängen an der Liga-ID, nicht am Nutzer. Ohne Prüfung könnte jeder Angemeldete mit einer
fremden Liga-ID in der URL deren Einstellungen überschreiben oder gespeicherte Transfers
lesen. `lib/auth.js` prüft deshalb bei jedem Zugriff gegen `/v4/leagues/selection`, ob der
Token zu einem Mitglied dieser Liga gehört.

### Regeln

- **Jede Seite und jede Route, die eine `league`-ID aus der URL nimmt, prüft sie.**
  Seiten über `verlangeLiga()` (leitet zur Ligaauswahl um), Routen über `pruefeApi()`.
- **Server Actions prüfen selbst.** Die Liga-ID kommt aus dem Formular und ist
  manipulierbar — die Prüfung in der Seite schützt die Action nicht.
- **Alles, was schreibt, läuft über POST.** Ein GET, das Daten ändert, lässt sich von einer
  fremden Seite aus auslösen — `/api/aufraeumen?alles=1` löscht rekonstruierte Einträge.
  `pruefeApi()` verlangt zusätzlich einen Origin-Header derselben Herkunft.
- `meineLigen()` liegt in `cache()` von React: mehrere Prüfungen in einem Seitenaufbau
  kosten trotzdem nur einen Kickbase-Request.

Was das **nicht** leistet: Mitglieder derselben Liga teilen sich Einstellungen und
Korrekturen. Wer in der Liga ist, kann sie für alle ändern. Das ist so gewollt — eine Liga
ist ein gemeinsamer Datensatz.

---

## Aussehen und Layout

Alle Farben, Abstände, Radien und Breakpoints stehen in `app/globals.css`. Die Seiten
benutzen Klassen mit `kb-`-Präfix, keine Style-Objekte mehr.

**Warum das wichtig ist:** Inline-Styles können keine Media Queries. Solange das Layout in
`const S = {...}` steckte, war Mobile-Unterstützung technisch unmöglich — genau das war der
Blocker, der in den nächsten Schritten stand.

### Regeln

- Neue Werte als Token in `:root` ergänzen, nicht als Hexcode in die Komponente schreiben.
- Inline-`style` nur noch für echte Einzelfälle (ein Abstand an genau einer Stelle).
  Alles, was sich auf schmalen Displays anders verhalten muss, gehört in eine Klasse.
- Breakpoints: `900px` (Kopfzeile stapelt), `640px` (Handy hochkant), `360px` (kleine Handys).

### Hinweise sind Popups

Erklärungen und Warnungen standen früher als große Kästen dauerhaft auf der Seite und haben
die Zahlen verdrängt, um die es geht. `app/_ui/Hinweis.jsx` zeigt stattdessen einen
einzeiligen Anreißer; der ganze Text kommt auf Klick in einem `<dialog>`.

Zwei Fallen dabei, beide beim Testen aufgefallen:

- `<dialog>` zentriert sich über `margin: auto` aus der Browser-Vorgabe. Der Reset von
  Tailwind setzt `margin: 0` auf alles und zieht das Fenster damit in die linke obere Ecke.
  `.kb-dialog` setzt `margin: auto` deshalb wieder.
- Der Klick neben das Fenster lässt sich **nicht** über `e.target === dialog` erkennen: der
  Inhalt füllt das `<dialog>` vollständig aus, es bleibt keine Fläche des Elements selbst
  übrig. Geprüft werden die Klickkoordinaten gegen `getBoundingClientRect()`.

Kurze Rückmeldungen auf eine gerade ausgelöste Aktion („12 neue Events importiert") bleiben
einzeilig im Fluss — sie sind die Antwort auf einen Klick und verschwinden von selbst.

### Tabelle auf schmalen Displays

Platz ist für den Namen und **drei Zahlen**. Welche drei, entscheidet die Sortierung:
**Gesamtwert** und **Kontostand** stehen fest, der dritte Platz gehört der Spalte, nach der
gerade sortiert wird — sonst ordnet ein Tippen auf „Trend" die Zeilen zwar richtig, zeigt
aber nirgends einen Trend. Ohne Sortierung nach einer Nebenspalte steht dort Max-Gebot; das
lässt sich aus Kontostand und Limit herleiten und ist damit am ehesten entbehrlich. Alle übrigen Spalten wandern in eine Detailzeile, die das `+` vor dem Namen aufklappt. Dort stehen **alle** Werte ausgeschrieben,
weil die Spalten selbst auf Kurzform umschalten (`euroKurz`: „53,7 Mio" statt „53.700.000 €").

Die Sortierung läuft auf dem Handy über die Chipleiste über der Tabelle, weil die
ausgeblendeten Spalten keine anklickbare Überschrift mehr haben.

Geprüft mit Chromium bei 320/360/390/430/640/768/900/1280 px: kein horizontales Scrollen
der Seite, ab 390 px passt auch die Tabelle ohne Scrollen. Bei 768–900 px scrollt die
vollständige Tabelle innerhalb ihres Rahmens, die Namensspalte bleibt dabei stehen.

### Dunkelmodus ist bewusst aus

Die frühere `prefers-color-scheme`-Regel hat nur `body` umgefärbt, während Karten und
Tabelle fest auf Weiß standen — auf einem dunkel gestellten Handy stand heller Text auf
weißem Grund. Die Regel ist raus. Ein echter Dunkelmodus geht erst, wenn auch die
Diagnose-Seiten über Tokens laufen; dann reicht ein zweiter Block mit den Dunkelwerten.

---

## Dateien

```
app/
  layout.js                        Wurzel-Layout: Viewport-Meta, Metadaten, Schrift
  page.js                          Startseite → leitet auf /liga um
  globals.css                      Design-Tokens, Komponentenklassen, Breakpoints
  login/page.js                    Client-Komponente, Login-Formular → /liga
  liga/page.js                     Hauptseite: Auswahl, Kalibrierung, Status, Datenlücke
  liga/Tabelle.jsx                 "use client" — sortierbar, Namensspalte sticky
  liga/manager/[id]/page.js        Managerseite: Kennzahlen, Finanzen, Kader, Transfers
  liga/manager/[id]/Verkaufsrechner.jsx  "use client" — Verkäufe durchspielen
  liga/markt/page.js               Markt: freie Spieler, Kaufkraft der Liga
  liga/markt/Freieliste.jsx        "use client" — sortier- und durchsuchbar
  liga/transfermarkt/page.js       Live-Sicht: was gerade angeboten wird
  liga/transfermarkt/Marktliste.jsx  "use client" — filtern nach Anbieter
  liga/Verlauf.jsx                 "use client" — Teamwert-Verlauf als Liniendiagramm
  liga/Frag.jsx                    "use client" — Fragen an ein LLM, Schlüssel im Browser
  _ui/Hinweis.jsx                  "use client" — Hinweis als anklickbares Popup
  api/frag/route.js                Frage → Antwortstrom
  api/modelle/route.js             Modellliste beim Anbieter erfragen
  api/aktualisieren/route.js       Feed, Teamwerte, Kader, Historie in einem Lauf
  _diagnose/Endpunkte.jsx          gemeinsamer Baustein der Diagnose-Seiten
  liga/einstellungen/page.js       Server Action, Grundwerte + Korrekturen pro Manager
  api/auth/login/route.js          Token → httpOnly-Cookie (kb_token, kb_uid, kb_name)
  api/ich/route.js                 Manuelle Selbstzuordnung → Cookie kb_name
  api/import/route.js              Feed-Import
  api/rekonstruieren/route.js      Historie nachladen
  api/teamwerte/route.js           Teamwerte je Manager laden
  api/aufraeumen/route.js          rk-Einträge löschen (?alles=1 für alle)
  markt/page.js                    Transfermarkt (früh gebaut, wenig gepflegt)
  bonus/page.js                    Diagnose: Login-Bonus-Verlauf
  rk/page.js                       Diagnose: rekonstruierte Einträge + Feed-Vergleich
  manager-detail/page.js           Diagnose: alle Transfers eines Managers, mit Quelle
  feed|ranking|spieler|pool|team|manager/page.js   Endpoint-Diagnosen

lib/
  kickbase.js       kbLogin, kbFetch
  db.js             sql, initSchema, getSettings, logImport, getImportStatus, getTeamwerte
  importer.js       importiere() — Feed, Batch-Insert via UNNEST
  marktbeobachtung.js speichereMarkt(), sammleBeobachtungen(), aktuellAmMarkt()
  rekonstruktion.js rekonstruiere(), holeSpielerPool()
  rhythmus.js       bildeAuftritte(), schaetzeZyklus(), prognostiziere()
  aufschlag.js      werteAus(), proManager() — Aufschlag über Marktwert
  verlauf.js        tagesraster(), tagesreihen() — Tagesstützstellen 0 Uhr
  anbieter.js       frageStream(), holeModelle() — Claude, ChatGPT, Gemini
  auth.js           sitzung(), istMitglied(), verlangeLiga(), pruefeApi() — Zugriffsschutz
  kader.js          ladeKader() — Kader je Manager
  ledger.js         loginBonus(), berechneKonten() — das Herzstück
  schnappschuss.js  baueSchnappschuss() — Datensatz für die Frage-Funktion
  teamwerte.js      ladeTeamwerte()
  format.js         euro, euroKurz, prozent, zeitpunkt, vorZeit, restzeit, position,
                    normalisiereSpieler, findeSpielerListe, findeBild
```

---

## Umgang mit Rate Limits und Timeouts

Kickbase drosselt. Alle Importer folgen demselben Muster:

- 200–350 ms Pause zwischen Requests
- Bei HTTP 429/503: exponentieller Retry (max. 4 Versuche)
- **Zeitbudget 45 s**, dann kontrollierter Abbruch mit gespeicherter Position (Vercel bricht bei 60 s hart ab)
- Fortsetzung beim nächsten Klick ab der gespeicherten Position
- Batch-Insert über `UNNEST` statt Einzel-Inserts — ein früherer Einzel-Insert-Ansatz lief bei größeren Ligen in den Timeout

Alle Seitenaufrufe lesen aus der Datenbank, nie live von Kickbase. Ausnahme sind die wenigen Stammdaten-Abrufe pro Seitenaufruf (`overview`, `ranking`, `me`).

**Der Nutzer will die Aktualisierung ausdrücklich manuell.** Kein Cron-Job.

Es gibt genau **einen** Knopf dafür: `/api/aktualisieren` macht Feed, Teamwerte, Kader und
Historie nacheinander mit gemeinsamem Zeitbudget. Einzelrouten für die Schritte gab es
früher, sie sind bis auf `import`, `teamwerte` und `rekonstruieren` entfallen. Über `ziel`
kommt der Lauf dorthin zurück, wo geklickt wurde — aus einer festen `Map`, damit sich die
Weiterleitung nicht auf eine fremde Seite umbiegen lässt. (Ein Objektliteral wäre hier
falsch: `__proto__` und `constructor` liefern dort geerbte Werte statt `undefined`.)

---

## Zeitzone

Alles wird in **deutscher Zeit** angezeigt und eingegeben (`ZONE` in `lib/format.js`),
unabhängig davon, wo der Server steht. Ohne diese Festlegung nimmt `toLocaleString` die
Zone der Laufzeitumgebung — auf Vercel ist das UTC, im Sommer also zwei Stunden neben der
Uhr des Nutzers.

Fest auf Berlin statt auf die Zone des Browsers, weil die Liga eine deutsche ist: Kickbase
nennt Marktschluss und Reset in deutscher Zeit. Ein fester Wert sorgt außerdem dafür, dass
Server und Browser dieselbe Zeichenkette erzeugen — sonst gäbe es beim Hydrieren Ärger.

**Der Stichtag ist der kritische Punkt.** Er kam aus dem Formular ohne Zeitzone in eine
`TIMESTAMPTZ`-Spalte, Postgres las ihn als UTC — der gespeicherte Zeitpunkt lag also zwei
Stunden hinter dem, was der Nutzer eingetippt hatte. Da `berechneKonten` mit
`dt >= stichtag` filtert, konnten dadurch Transfers rund um den Reset falsch ein- oder
ausgeschlossen werden. `ausEingabe()` liest die Eingabe jetzt als deutsche Ortszeit,
`fuerEingabe()` schreibt sie so zurück.

Geprüft über 1460 Zeitpunkte eines Jahres: alle kommen unverändert zurück. Einzige
Ausnahme ist die Stunde, die es in der Nacht der Rückstellung zweimal gibt — die wird als
Winterzeit gelesen. Für einen Stichtag ohne Belang.

---

## Bekannte Eigenheiten

**Manager werden über Anzeigenamen identifiziert, nicht über IDs.** Der Feed liefert `byr: "Lamlo"`, keine ID. Bei Namensänderung bricht die Zuordnung. Doppelte Namen werden in der UI markiert.

**Der Liga-Admin wird gefiltert** (`m.adm !== true`), weil er in der Beispielliga nicht mitspielt. Sobald das Tool an fremde Ligen geht, sollte das eine Einstellung werden — in anderen Ligen kann der Admin durchaus Manager sein.

**Selbstzuordnung:** Erst über `kb_uid` (aus dem Login, Feldname unsicher), dann über `kb_name`. Schlägt beides fehl, wählt der Nutzer sich einmalig aus einer Liste — das ist der zuverlässige Fallback.

**Keine Heuristik ohne Plausibilitätsgrenze.** Die Kalibrierung deutete eine Abweichung
als „so viele Tage Login-Bonus", sobald sie glatt durch 100.000 teilbar war. Transferpreise
sind fast immer glatte Beträge — so kamen „227 Tage Login-Bonus" bei einer Liga heraus, die
20 Tage alt ist. Ein Tagesäquivalent wird jetzt nur genannt, wenn es überhaupt in die
Laufzeit der Liga passt; sonst stehen dort nur die beiden wahrscheinlichen Ursachen
(Login-Bonus, alte Strafe) ohne erfundene Genauigkeit.

**Punkte-Bonus (10.000 €/Punkt) ist unverifiziert.** Zur Zeit der Entwicklung war `sp: 0` bei allen, weil die Saison noch nicht lief. Nach dem ersten Spieltag muss die Kalibrierung erneut geprüft werden.

**Kadergröße:** Kommt aus `dashboard.t`. Der Wert wirkte mit 48 zu hoch für einen Kader — möglicherweise etwas anderes. Falls die Zahl in Klammern unsinnig aussieht, aus `squad` holen.

---

## Kennzahlen in der Tabelle

- **Kontostand** = berechnetes Guthaben (früher „Liquidität" genannt)
- **Teamwert** = aus `dashboard.tv`, muss separat geladen werden (ein Request je Manager)
- **Spieler** = Kadergröße aus `dashboard.t`
- **Limit** = Teamwert ÷ 3 = erlaubtes Minus
- **Max-Gebot** = Kontostand + Limit = höchstes Gebot ohne vorherigen Verkauf
- **Gesamtwert** = Kontostand + Teamwert = Gesamtvermögen
- **Liquidität** = Kontostand ÷ Gesamtwert, also der flüssige Anteil des Vermögens.
  Ohne geladenen Teamwert nicht aussagekräftig, steht dann auf „–".
- **Trend** = Veränderung des Teamwerts gegenüber dem vorherigen gespeicherten Stand.
  Kickbase passt die Marktwerte täglich an, der Trend zeigt also im Normalfall die Bewegung
  des letzten Tages. **Käufe und Verkäufe zählen mit hinein** — wer für 20 Mio kauft, steht
  mit +20 Mio da, ohne dass ein Marktwert gestiegen wäre. Eine Bereinigung um die Transfers
  des Zeitraums wäre möglich, hätte aber einen eigenen Fehler: gehandelt wird zum
  Angebotspreis, nicht zum Marktwert.
- **Anpassungen** = Strafen + manuelle Korrektur gebündelt. Die Aufschlüsselung steht in
  der aufgeklappten Detailzeile und auf der Managerseite.

Werte von Managern in einer Liga mit Datenlücke werden mit `~` und `ca.` gekennzeichnet,
die eigene Zeile mit `exakt`.

### Kaderprofil auf der Managerseite

Direkt unter den Kennzahlen steht, was der Manager hat und was ihm fehlt:

- **Topspieler** (Marktwert über 25 Mio) mit Anzahl und Namen
- **Bedarf je Position** (Tor, Abwehr, Mittelfeld, Sturm): hat der Manager dort keinen
  Spieler über 10 Mio, ist das Feld gelb markiert. Gezeigt wird jeweils der teuerste
  Spieler der Position, damit man den Abstand zur Schwelle sieht.

Beide Schwellen stehen als benannte Konstanten oben in der Datei. Spieler ohne erkennbare
Position würden den Bedarf verfälschen — sie werden separat gezählt und ausgewiesen.

Der Managername führt zur **Managerseite** (`/liga/manager/{id}?league={liga}`): Kennzahlen,
die vollständige Kontorechnung Posten für Posten, der aktuelle Kader und alle Transfers mit
Quelle (Feed oder rekonstruiert).

### Die Marktseite

`/liga/markt` beantwortet zwei Fragen: welche Spieler gehören niemandem, und könnte die
Liga sie überhaupt bezahlen.

- **Frei** = im Bundesliga-Pool, aber in keinem gespeicherten Kader. Ohne geladene Kader
  gilt jeder Spieler als frei — die Seite sagt das dann auch deutlich.
- **Verhältnis** = Summe aller Kontostände ÷ Marktwert der freien Spieler im gewählten
  Bereich. Der Marktwert-Filter ist dabei das eigentliche Werkzeug: ohne ihn zählen
  hunderte Ergänzungsspieler mit, die nie jemand kauft, und das Verhältnis sieht
  schlechter aus als es ist.

Der Spielerpool speichert seit der Marktseite auch Marktwert und Position. Der Cache-
Schlüssel heißt deshalb `bundesliga_v2` — alte Einträge hatten nur ID und Name.

### Spielernamen kommen nicht aus dem Kader

`/squad` liefert Position, Marktwert und Kaufpreis, aber unter keinem der bekannten Felder
(`fn`, `ln`, `n`, `name`, …) einen Namen — im Kader stand deshalb überall „Unbekannt".
Statt weitere Feldnamen zu raten, holt `lib/spielernamen.js` die Namen über die Spieler-ID
aus zwei vorhandenen Quellen: dem Bundesliga-Pool und den `events` dieser Liga, wo jeder
Transfer den Namen mitführt. Events gewinnen, weil sie den Namen so schreiben, wie die Liga
ihn sieht. Bleibt einer übrig, steht dort `Spieler #4711` statt dreizehnmal „Unbekannt".

### Bilder und Spielerdaten werden gesucht, nicht geraten

Unter welchem Feld Kickbase Bilder ausliefert, ist nicht belegt. `findeBild()` probiert
bekannte Kandidaten (`pim`, `uim`, `img`, …) und nimmt sonst das erste Feld, dessen Wert
wie eine Bildadresse aussieht. Fehlt eines, steht ein Platzhalter — die Namen bleiben
bündig.

Dasselbe gilt für Punkteschnitt, Punkte und Marktwert-Trend auf `/liga/transfermarkt`:
`normalisiereSpieler()` probiert die bekannten Feldnamen durch. Wie viele Angebote die
jeweilige Angabe tatsächlich haben, steht als **Abdeckung** unter der Tabelle. Leere
Spalten sind damit sichtbar als fehlende Daten und nicht als Fehler — und wenn eine Angabe
durchgehend fehlt, sagt die Seite das ausdrücklich.

**Was noch nicht geht:** die Punkte der letzten fünf Spiele. Dafür liefert der
Markt-Endpoint nichts; es bräuchte einen zweiten Abruf je Spieler. Ob es ihn gibt, ist
unbelegt — `/spieler?league=…&pid=…` probiert die Kandidaten durch.

### Der Kader-Endpoint

`/v4/leagues/{id}/managers/{uid}/squad` wurde nie ausgewertet, nur roh gedumpt — welches
Feld die Spielerliste trägt, ist unbelegt. `findeSpielerListe()` rät deshalb nicht, sondern
sucht das erste Array, dessen Einträge nach Spielern aussehen (bekannte Kandidaten `it`,
`pl`, `players` zuerst). Findet es nichts, zeigt die Managerseite einen Hinweis auf die
Diagnose-Seite statt einer leeren Tabelle.

## Nächste Schritte

**Erledigt:** Mobile Responsiveness, Managerseite mit Verkaufsrechner, Marktseite,
Zugriffsschutz, persönliche Einstellungen je Nutzer, ein gebündelter Aktualisieren-Knopf,
Frag-die-Liga mit drei Anbietern.

1. **Punkte-Bonus nach dem ersten Spieltag verifizieren.** Bis dahin ist `sp` überall 0 und
   der Posten trägt nichts bei — die Annahme 10.000 €/Punkt ist weiter unbewiesen.
2. **Dunkelmodus.** Alle Seiten laufen über Tokens, es fehlt nur ein zweiter Block mit den
   Dunkelwerten in `globals.css`.
3. **Admin-Filter zur Einstellung machen.** `m.adm !== true` ist hart verdrahtet.
4. **`markt/page.js` (der alte Transfermarkt) überarbeiten** — nicht zu verwechseln mit
   `/liga/markt`.
5. **Bietrechner:** wer kann bei welchem Spieler mitbieten — alle Zahlen dafür stehen bereit.

## Arbeitsweise

Der Nutzer arbeitete bisher über die GitHub-Weboberfläche, deshalb wurden **immer vollständige Dateien** geliefert, nie Ausschnitte. Fast alle Build-Fehler entstanden durch abgeschnittene oder doppelt eingefügte Blöcke beim Copy-Paste.

Bei Unsicherheit über einen Endpoint oder ein Datenformat: **erst eine Diagnose-Seite bauen, die mehrere Kandidaten durchprobiert, dann implementieren.** So sind alle bisherigen Erkenntnisse entstanden. Raten hat in diesem Projekt mehrfach zu Fehlern geführt, die erst durch die Kalibrierung auffielen — oder gar nicht, weil sie nur Gegner betrafen.

Alles auf Deutsch: UI, Variablennamen, Kommentare.
