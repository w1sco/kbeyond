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
| `/v4/leagues/{id}/lineup` | **Die echte Aufstellung**: `it[]` mit `i`, `n`, `lo` (Position 1–11), `st`, `lst` |
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

> **Es gibt keinen Endpoint für Kontobewegungen pro Manager.** Das wurde systematisch
> geprüft — mit einer Einschränkung: Ein anderes Werkzeug an derselben API gibt an, eine
> **paginierte Transferhistorie je Manager** zu benutzen. `/ligamonitor?league=…` probiert
> die Kandidaten dafür durch, dazu einen Aufstellungs-Endpunkt, die Marktwertkurve und ein
> Spielerprofil mit Startelf-Wahrscheinlichkeit.
>
> **Auch wenn sich das bestätigt, bleibt der Feed nötig:** Strafen und Login-Boni stehen
> nirgendwo sonst. Eine Transferhistorie ersetzt die Rekonstruktion alter Käufe, nicht den
> Feed.

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
1. Alle 18 `teamprofile`-Kader (~470 Spieler), gepflegt in `pool_cache`
2. **Alle Spieler-IDs, die bereits in `events` vorkommen** — erwischt Spieler, die heute in keinem Bundesliga-Kader mehr stehen

Punkt 2 wurde nachträglich ergänzt, weil ein Kauf (Baur, 8.8.) fehlte: Der Spieler war inzwischen weg, tauchte also im Kader-Pool nicht auf, war aber über sein späteres Verkaufs-Event in der Datenbank bekannt.

#### Neuzugänge: täglich nachsehen, ergänzen statt ersetzen

Die Bundesliga steht nicht still — Spieler kommen neu dazu, wechseln den Verein, ändern
ihren Marktwert. `aktualisierePool()` geht deshalb einmal am Tag alle 18 Vereine durch,
nach **derselben Regel wie Teamwerte und Kader**: Ist der Stand von vor der letzten
deutschen Mitternacht, wird nachgesehen. Neuzugänge werden im Ergebnis namentlich genannt
(„2 neue Spieler (Neuzugang Winter, …)"), damit man sieht, dass es greift.

**Zusammengeführt, nicht überschrieben.** Der Pool wurde früher bei jedem Aufbau komplett
ersetzt. Scheiterte ein einziger Vereinsabruf, verschwanden dessen Spieler aus dem Pool —
und damit aus der Marktseite, der Rekonstruktion und dem Datensatz für die Frage-Funktion.
Jetzt werden Bekannte aktualisiert und Neue ergänzt; ein ausgefallener Verein kostet nichts,
seine Spieler bleiben aus dem letzten Stand stehen.

Der **Stand wird nur fortgeschrieben, wenn wirklich alle Vereine dran waren.** Sonst stünde
ein halber Durchlauf als „heute erledigt" da und die fehlenden Vereine kämen erst am
nächsten Tag dran. So macht der nächste Klick einfach weiter; solange etwas fehlt, steht es
unter „offen" (`Spielerliste (14/18 Vereine)`).

#### Gebaut wird nur im Aktualisieren-Lauf

**`holePool()` liest, `aktualisierePool()` schreibt — und schreiben darf nur die
Aktualisieren-Route.** Vorher hing beides in `holePoolGecached()` zusammen: War der Cache
24 Stunden alt, feuerte der **Seitenaufruf** der Marktseite 19 Kickbase-Anfragen mitten im
Rendern — an der Bremse vorbei und ohne dass jemand auf einen Knopf gedrückt hätte. Genau
die Art versteckter Last, wegen der der Nutzer schon einmal nicht mehr in Kickbase kam.

Ist der Pool leer, sagt die Marktseite das („Spielerliste noch nicht geladen — einmal
aktualisieren") statt einen leeren Markt vorzutäuschen.

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

### Was bis zum Anpfiff noch kommt

Die Kauf- und Verkaufsrechner rechnen die **noch ausstehenden Gutschriften** mit. Wer am
Mittwoch überlegt zu kaufen, hat bis Freitag zwei Nächte mehr auf dem Konto — das ist
sicheres Geld und gehört in die Planung.

Gezählt werden **Mitternachte bis zum ersten Spiel des Spieltags**, weil der Bonus um 0:00
Uhr kommt. Der Wochentag steht in den Einstellungen (`liga_settings.spieltag_start`):
Freitag (Vorgabe), Samstag oder Dienstag.

**Ist heute schon Spieltag, kommt nichts mehr dazu.** Die Gutschrift von heute Nacht steckt
bereits im Kontostand. Das ist die vorsichtige Lesart — sie verspricht nie Geld, das noch
nicht da ist. Ein Anpfiff am Abend ändert daran nichts, weil zwischen jetzt und dem
Anpfiff keine Mitternacht mehr liegt.

Gerechnet wird mit dem **Tagesbonus**, nicht mit der Summe: `tagesBonus(n)` ist die
Differenz zweier Staffelungssummen. In einer jungen Liga sind die nächsten Nächte deshalb
unterschiedlich viel wert (Tag 4 = 40k, Tag 5 = 50k), ab Tag 10 konstant 100k. 19 Fälle
durchgerechnet (`pruefstand/loginboni.mjs`), Übergang von Tag 9 auf 10 eingeschlossen.

`lib/loginbonus.js` ist deshalb **von `ledger.js` getrennt**: reine Rechnung, kein `sql`.
Sonst ließe sie sich nicht ohne Postgres durchrechnen — `ledger.js` zieht die Datenbank
herein und ist für einen nackten Node-Lauf unerreichbar.

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

liga_settings(league_id PK, stichtag, startbudget, punkte_bonus, login_aktiv,
              login_start, spieltag_start, notiz)
korrektur(league_id, manager, betrag, grund)          -- PK (league_id, manager)
import_log(league_id PK, letzter_lauf, neue_events, gesamt, offset_pos, komplett)
rekon_log(league_id PK, position, fertig, letzter, gefunden)
pool_cache(id PK, daten JSONB)                        -- 'bundesliga', 24h TTL
teamwerte(league_id, manager_id, teamwert, spieler, stand)  -- PK (league_id, manager_id)
marktwert_verlauf(player_id, tag, marktwert)                -- PK (player_id, tag), ligaunabhängig
marktwert_geprueft(player_id, geprueft, gefunden)           -- wen wir schon gefragt haben
mw_beobachtung(player_id, tag, marktwert)                   -- PK (player_id, tag)
  eigene Ablesung je Marktwert-Tag (Grenze 22:04), ligaunabhängig
tagesstand(league_id, manager_id, tag, teamwert, konto, punkte)
  PK (league_id, manager_id, tag) — Grundlage der Platzierungspfeile
teamwert_verlauf(league_id, manager_id, teamwert, stand)   -- PK (league_id, manager_id, stand)
  + Index (league_id, manager_id, stand DESC)
markt_beobachtung(league_id, player_id, ablauf, gesehen)   -- PK (league_id, player_id, ablauf)
  + Index (league_id, player_id)
news(league_id, player_id, name, text, stimmung, quellen JSONB, stand)
  PK (league_id, player_id) — leerer text = nachgesehen, nichts gefunden
kader(league_id, manager_id, player_id, name, position, marktwert, kaufpreis,
      punkte, aufgestellt, stand)
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

## Spieler-News

`/liga/news` zeigt Meldungen der letzten 7 Tage zu den Spielern im eigenen Kader und zu
allen Angeboten am Transfermarkt, kurz zusammengefasst unter dem jeweiligen Namen.

### Die News werden recherchiert, nicht geliefert

Kickbase hat keine Nachrichten, und das Projekt hat keine Redaktion. Geholt wird über die
**Websuche des Modells**: Claude sucht selbst und fasst zusammen. Damit sind überregionale
Quellen (kicker, ligainsider), Regionalmedien (Deichstube, DerWesten) und
Transfer-Journalisten wie Fabrizio Romano gleichermaßen erreichbar.

**Die Suche wird bewusst nicht auf eine Domainliste eingeengt.** Eine feste Liste schlösse
genau die regionalen Quellen aus, die man vorher nicht aufzählen kann. Stattdessen stehen
die bevorzugten Quellen in der Anweisung, und jede Meldung muss ihre Herkunft nennen — so
ist am Ergebnis ablesbar, worauf sie beruht.

**Nur Claude.** Die Websuche ist ein serverseitiges Werkzeug der Anthropic-API; ChatGPT und
Gemini haben eigene, anders geformte Mechanismen. Die Frage-Funktion kann weiterhin alle
drei; die Recherche kann es nicht, und die Seite sagt das.

### Gesucht wird über Name und Verein, nicht über die ID

Das Internet kennt die Kickbase-Spieler-ID nicht. Sie stand trotzdem in der Spielerliste
des Prompts und half dort niemandem — schlimmstenfalls landete sie in einer Suchanfrage.
Übergeben werden jetzt **Name und Vereinsname**, zugeordnet wird über eine **laufende
Nummer** aus der Liste.

Der Verein war der eigentliche Fehler: Übergeben wurde die **Team-ID**, also „Undav (7)".
Der Pool trägt deshalb jetzt den Vereinsnamen. Unter welchem Feld er in der Tabelle steht,
ist nicht belegt — `vereinsname()` probiert die Kandidaten durch und gibt im Zweifel `null`
zurück. **Lieber keine Angabe als eine Zahl:** „(7)" ist für eine Nachrichtensuche
schlimmer als gar nichts.

**Sieben Tage, nicht dreißig.** Was älter ist, hat für die Aufstellung am Wochenende keine
Bedeutung mehr, und ein enger Zeitraum liefert schärfere Treffer.

### Alles vom Modell wird geprüft, nicht übernommen

Das Modell antwortet mit Text, nicht mit einem Versprechen. `findeArray()` schneidet das
JSON heraus (auch aus einem Codeblock oder aus Fließtext) und probiert **jede** öffnende
Klammer als Anfang durch — eine Klammer im Fließtext („laut [1] und [2]") zerriss sonst den
Ausschnitt. `saubereMeldung()` verwirft unbekannte Spieler-IDs, erfundene Stimmungswerte und
Nicht-http-URLs und deckelt Textlänge und Quellenzahl. 22 Fälle durchgerechnet
(`pruefstand/news.mjs`).

### Sammeln ist der Normalfall, Tiefensuche die Ausnahme

Der erste Entwurf suchte für **jeden Spieler einzeln und breit**. Bei Kader plus
Transfermarkt waren das 71 Recherchen für einen Knopfdruck — zu teuer, und die Anfragen
liefen in Vercels Zeitgrenze (der Nutzer sah `Fehler 504`, bevor irgendetwas gespeichert
war).

**Sammelmodus** (Vorgabe): Ein Aufruf deckt **zwölf Spieler** ab, und gesucht wird auf
**Übersichtsseiten** — die Ausfall- und Sperrenlisten von ligainsider, kicker und
transfermarkt führen hunderte Spieler auf einmal. Drei Suchen beantworten damit die Frage
für ein ganzes Bündel statt für einen Spieler. Aus 71 Recherchen werden sechs Anfragen.

**Einzelmodus**: die Tiefensuche mit mehr Suchen, breiteren Quellen und höherem Effort —
nur auf ausdrücklichen Klick („genauer") und immer für genau einen Spieler.

**Welcher Modus gilt, entscheidet die Route**, nicht der Browser: Ein manipulierter Aufruf
soll sich keinen teureren Lauf aussuchen können, als vorgesehen ist.

Der Browser ruft wiederholt auf und zeigt den Fortschritt. Was fertig ist, steht in `news`
und bleibt — ein Abbruch kostet nur das laufende Bündel.

**Ein Ausfall reißt den Lauf nicht mehr mit.** Vorher beendete eine Zeitüberschreitung bei
Spieler 1 alle übrigen 70. Jetzt wird der betroffene Spieler vermerkt und weitergemacht;
scheitern die ersten drei Versuche ohne einen einzigen Erfolg, bricht der Lauf ab, statt
70-mal weiter Geld auszugeben.

Fehlermeldungen der API werden **übersetzt, nicht durchgereicht**: „Der API-Schlüssel wird
abgelehnt" statt eines JSON-Klumpens.

**Ein Ergebnis wird gespeichert, eine ausbleibende Antwort nicht.** „Nichts gefunden" ist
ein Ergebnis und wird abgelegt, sonst kostet derselbe Spieler bei jedem Lauf erneut Geld.
Ein Spieler, zu dem das Modell **gar nichts gesagt hat**, ist aber kein Ergebnis. Genau
daran scheiterte ein Lauf über 70 Spieler: Alle wurden als „nichts gefunden" abgelegt,
galten damit als erledigt und wurden nie wieder abgefragt — obwohl in Wahrheit nie eine
Antwort kam. Ein Knopf **„N leere verwerfen"** räumt solche Einträge weg.

„Nichts Neues in den letzten 7 Tagen" und „Noch nicht recherchiert" sind deshalb zwei
verschiedene Zustände, und die Seite zeigt sie verschieden.

### Ein stiller Ausfall sieht aus wie ein Ergebnis

Null Meldungen können drei sehr verschiedene Dinge heißen: Das Modell hat gesucht und
nichts gefunden; es hat geantwortet, aber mit IDs, die sich nicht zuordnen lassen; oder die
Websuche lief gar nicht. Von außen sieht alles drei gleich aus.

Jeder Aufruf gibt deshalb zurück, **wie viele Suchen liefen, wie viele Einträge kamen und
wie viele davon verworfen wurden**. Bleibt ein ganzer Lauf ohne Meldung, nennt die Seite
diese Zahlen statt achselzuckend „keine News" anzuzeigen.

**Die Anweisung darf das Ergebnis nicht vorwegnehmen.** In der ersten Fassung stand darin,
zu den allermeisten Spielern sei nichts zu finden — bei niedrigem Effort ist „nichts" damit
die bequemste Antwort. Der Satz ist raus, dafür steht dort jetzt ausdrücklich, dass
mindestens zwei bis drei Suchen zu laufen haben und für **jeden** Spieler ein Eintrag mit
**exakt** der mitgegebenen ID zurückkommen muss.

Frisches wird nicht neu geholt: Was jünger als 12 Stunden ist, bleibt stehen. Ein zweiter
Knopf holt trotzdem alles neu.

### Welche Fassung der Websuche gilt, wird nicht geraten

Der Nutzer wählt sein Modell selbst, und das Werkzeug gibt es in zwei Fassungen
(`web_search_20260209`, `web_search_20250305`). Versucht wird die neuere; **nur bei 400**
wird die ältere genommen. Alles andere (Schlüssel ungültig, Guthaben leer) schlägt durch,
statt ein zweites Mal Geld zu kosten.

### Erfinden ist schlimmer als nichts

In der Anweisung steht ausdrücklich, dass ein Spieler ohne Meldung ein gültiges Ergebnis
ist. Eine erfundene Verletzungsmeldung wäre hier deutlich schädlicher als eine leere Zeile
— danach würde jemand verkaufen.

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

### Ein Verkauf setzt die Uhr neu

Verankert wird am letzten Ereignis, das den Spieler **frei gemacht** hat: sein letzter
Auftritt am Markt (er lief ungekauft ab) oder sein **Verkauf an Kickbase** — je nachdem,
was später war. Wer gekauft und wieder verkauft wurde, geht zurück in den Pool und kommt
von dort nach dem Rhythmus wieder.

Ohne diesen Anker stand bei genau diesen Spielern „Rhythmus unbekannt", obwohl sich die
Prognose direkt ausrechnen lässt: Verkaufsdatum + Rhythmus.

### Solange nichts gemessen ist, gilt der Startwert

`BASIS_ZYKLUS_TAGE = 14` — die bekannte Ausgangslage einer Liga. Solange weniger als vier
Abstände beobachtet sind, wird damit gerechnet und die Prognose als **Annahme**
gekennzeichnet. Das ist keine erfundene Genauigkeit, sondern die dokumentierte
Ausgangslage; sobald genug gemessen ist, ersetzt der gemessene Rhythmus sie.

### Was nicht prognostiziert wird

- **Alles vor dem Stichtag.** Die Historie vor dem Liga-Reset sagt über den heutigen
  Rhythmus nichts.
- **Spieler, die seit dem Reset weder am Markt waren noch verkauft wurden.** Die kommen in
  den nächsten Tagen, aber ohne festen Abstand — der erste Auftritt nach einem Reset folgt
  keinem Rhythmus. Dort steht „kommt demnächst", kein Datum.

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

### Angemeldet bleiben

Das Cookie hielt sieben Tage, trotzdem musste man sich ständig neu anmelden. Zwei
Ursachen, beide nicht am Cookie:

**`loy` stand fest auf `false`.** Das ist Kickbases eigenes Kennzeichen für
„angemeldet bleiben" — bei jeder Anmeldung wurde also die kurze Sitzung
angefordert, auch wenn der Nutzer sie gar nicht wollte. Es folgt jetzt dem
Ankreuzfeld auf der Login-Seite (vorbelegt: ja).

**Ein abgelaufenes Token war ein Serverfehler.** Nachgemessen mit `KB_401=1`:
`/liga` antwortete mit **HTTP 500**, `/liga?league=1` leitete auf „Kickbase
antwortet gerade nicht" — also auf `/liga`, das ebenfalls mit 500 endete. Wer
zurückkam, landete in jedem Fall auf einer Fehlerseite und hat sich wohl
deshalb neu angemeldet. Ursache: `app/liga/page.js` und `app/markt/page.js`
riefen `/leagues/selection` ohne Absicherung auf, und `verlangeLiga` warf alle
Fehler in denselben Topf.

`istAbgelaufen()` unterscheidet das jetzt am **Status am Fehlerobjekt**, nicht
am Meldungstext — `kbFetch` wirft `API-Fehler: 401`, ein Muster auf den Text
hat in diesem Projekt schon einmal die falschen Fehler eingefangen. Alle
Einstiege führen bei 401/403 nach `/login?abgelaufen=1`.

#### Die Laufzeit wird abgelesen, nicht geraten

Kickbase liefert ein JWT; dessen Nutzlast trägt den Ablauf als `exp`.
`tokenAblauf()` liest ihn und die Login-Route setzt das Cookie **genau so
lang, wie das Token wirklich gilt**. Ein Cookie, das ein totes Token trägt,
sieht aus wie „angemeldet" und ist es nicht.

Alles daran ist unsicher — es muss kein JWT sein, es muss kein `exp` enthalten,
der Wert muss nicht plausibel sein. Jeder Schritt prüft deshalb selbst und gibt
im Zweifel `null` zurück; dann greifen 90 Tage. Die Plausibilitätsgrenze fängt
unter anderem ein `exp` in Millisekunden ab, das sonst im Jahr 56000 landet und
das Cookie faktisch nie ablaufen ließe. Elf Fälle durchgerechnet.

Ohne Haken ist es ein **Sitzungscookie** — weg, sobald der Browser zugeht.

Wie lange ein Token tatsächlich gilt, ist unbelegt. Deshalb steht **„Anmeldung
gültig bis"** in der Statusleiste der Ligaseite: Die Antwort steht damit auf der
Seite, statt geschätzt zu werden.

> **Zugangsdaten werden nicht gespeichert.** Eine stille Neuanmeldung im
> Hintergrund („nie wieder anmelden") bräuchte das Passwort auf dem Server oder
> im Cookie. Das widerspricht dem, was die Login-Seite zusagt, und wurde bewusst
> nicht gebaut.

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
  login/page.js                    Login: Server-Teil, liest ?abgelaufen
  login/Formular.jsx               "use client" — Formular, „Angemeldet bleiben“
  liga/page.js                     Hauptseite: Auswahl, Kalibrierung, Status, Datenlücke
  liga/Tabelle.jsx                 "use client" — sortierbar, Namensspalte sticky
  liga/aufschlaege/page.js         Aufschläge über Marktwert, je Herkunft und Zeitraum
  liga/manager/[id]/page.js        Managerseite: Kennzahlen, Finanzen, Kader, Transfers
  liga/manager/[id]/Verkaufsrechner.jsx  "use client" — Verkäufe durchspielen
  liga/manager/[id]/Aufstellung.jsx      "use client" — elf Spieler auf dem Platz
  aufstellung/page.js              Diagnose: woran erkennt man die Startelf
  ligamonitor/page.js              Diagnose: Endpunkte aus dem Vergleich
  liga/markt/page.js               Markt: freie Spieler, Kaufkraft der Liga
  liga/markt/Freieliste.jsx        "use client" — sortier- und durchsuchbar
  liga/transfermarkt/page.js       Live-Sicht: was gerade angeboten wird
  liga/transfermarkt/Marktliste.jsx  "use client" — filtern nach Anbieter
  liga/Verlauf.jsx                 "use client" — Teamwert-Verlauf als Liniendiagramm
  liga/Frag.jsx                    "use client" — Fragen an ein LLM, Schlüssel im Browser
  liga/news/page.js                Spieler-News: eigener Kader und Transfermarkt
  liga/news/Newsliste.jsx          "use client" — Recherche in Bündeln, Fortschritt
  _ui/Hinweis.jsx                  "use client" — Hinweis als anklickbares Popup
  _ui/Schublade.jsx                "use client" — Off-Canvas, schließt über den Verlauf
  liga/layout.js                   children + paralleler Slot @panel
  liga/@panel/(.)manager/[id]/     fängt die Managerseite ab und zeigt sie als Schublade
  api/frag/route.js                Frage → Antwortstrom
  api/news/route.js                Ein Bündel Spieler recherchieren und ablegen
  api/modelle/route.js             Modellliste beim Anbieter erfragen
  api/aktualisieren/route.js       Feed, Markt, Marktwerte, Teamwerte, Kader, Historie
  marktwert/page.js                Diagnose: welcher Endpunkt liefert die Marktwert-Historie
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
  kickbase.js       kbLogin, kbFetch, tokenAblauf
  db.js             sql, initSchema, getSettings, logImport, getImportStatus, getTeamwerte
  importer.js       importiere() — Feed, Batch-Insert via UNNEST
  marktbeobachtung.js speichereMarkt(), sammleBeobachtungen(), aktuellAmMarkt()
  marktwerte.js     ladeMarktwertVerlauf(), ergaenzeMarktwerte() — Historie je Spieler
  rekonstruktion.js rekonstruiere(), holePool(), aktualisierePool()
  rhythmus.js       bildeAuftritte(), schaetzeZyklus(), prognostiziere()
  aufschlag.js      werteAus(), proManager() — Aufschlag über Marktwert
  verlauf.js        tagesraster(), tagesreihen() — Tagesstützstellen 0 Uhr
  anbieter.js       frageStream(), holeModelle() — Claude, ChatGPT, Gemini
  news.js           holeNews(), findeArray(), saubereMeldung() — Websuche via Claude
  auth.js           sitzung(), istMitglied(), verlangeLiga(), pruefeApi(),
                    holeLigen(), istAbgelaufen() — Zugriffsschutz
  kader.js          ladeKader() — Kader je Manager
  ledger.js         berechneKonten() — das Herzstück
  gebot.js          erlaubtesMinus(), maxGebot() — die Kickbase-Regel, ohne DB
  aufstellung.js    findeAufstellung(), felderAnalyse() — Startelf erkennen, ohne DB
  loginbonus.js     loginBonus(), tagesBonus(), kommendeLoginBoni() — ohne DB
  schnappschuss.js  baueSchnappschuss() — Datensatz für die Frage-Funktion
  teamwerte.js      ladeTeamwerte()
  format.js         euro, euroKurz, prozent, zeitpunkt, vorZeit, restzeit, position,
                    wochentag — deutscher Wochentag,
                    mwTag, letztesMwUpdate — Marktwert-Tag ab 22:04,
                    inZeit, normalisiereSpieler, findeSpielerListe, findeBild
```

---

## Herkunft: deutsche Region, deutscher Sprachkopf

Kickbase stuft einen Zugang nach Herkunft ein. Kommen die Aufrufe aus einer fremden Region
oder ohne deutsche Spracheinstellung, kann der Account auf „international" umspringen —
dann fehlen Inhalte, die es nur in der Bundesliga-Sicht gibt.

Deshalb: `Accept-Language: de-DE` an **jedem** Aufruf (in `kbFetch` und beim Login), und
`vercel.json` legt die Region auf **Frankfurt** (`fra1`) fest. Beides kostet nichts und
verhindert ein Problem, das man sonst nie als Ursache erkennen würde.

## Umgang mit Rate Limits und Timeouts

Kickbase drosselt — und einmal so hart, dass der Nutzer sich vorübergehend nicht mehr
einloggen konnte. Auslöser war ein Aktualisieren-Lauf mit **60 bis 300 Anfragen**, mehrfach
hintereinander geklickt.

**Alle Kickbase-Aufrufe laufen deshalb durch `kbFetch` in `lib/kickbase.js`** — eine Stelle,
eine Bremse. Vorher hatte jeder Lader seine eigene Kopie mit eigener Pause, es gab also
nirgends einen gemeinsamen Hebel.

Die Bremse macht drei Dinge:

1. **Mindestabstand von 600 ms** zwischen zwei Anfragen, über alle Lader hinweg.
2. **Bei 429/503 warten und wiederholen**, mit wachsendem Abstand und nach `Retry-After`,
   wenn Kickbase einen nennt.
3. **Bleibt es dabei, gilt der ganze Lauf als gedrosselt** und jeder weitere Aufruf bricht
   sofort ab. Das ist der wichtigste Punkt: Vorher machte jeder Lader für sich weiter und
   hat die Drosselung damit verlängert.

### Nur holen, was sich geändert hat

Kein Zeitfenster, sondern nachsehen. Ein erster Versuch mit „Teamwerte alle 6 Stunden, Kader
alle 12" war **falsch**: Hatte jemand vor einer Stunde gekauft, wäre sein Kader bis zu zwölf
Stunden veraltet gewesen.

`werBrauchtNeueDaten()` prüft je Manager, ob überhaupt etwas Neues zu holen ist. Beide
Datensätze ändern sich aus genau zwei Gründen:

| Grund | Wirkung |
|---|---|
| Ein **Transfer** | Ändert Zusammensetzung des Kaders und den Teamwert — aber nur bei dem einen Manager. Der Feed sagt, wer es war. |
| Die **tägliche Marktwertanpassung** | Danach sind Teamwert *und* die in `kader` gespeicherten Marktwerte je Spieler veraltet. Letztere sind wichtig: mit ihnen rechnet der Verkaufsrechner. |

Neu geholt wird also, wenn es keinen Stand gibt, der Stand von vor der letzten Mitternacht
(deutscher Zeit) ist, oder seither ein Transfer dieses Managers lief. Sonst nichts.

In der Praxis: Der erste Klick am Tag holt alles, jeder weitere kostet nur noch die Manager,
die seitdem gehandelt haben. Es fehlt dabei nie etwas. `?voll=1` erzwingt einen Vollabruf.

Dazu: Marktwert-Historien höchstens 10 Spieler je Lauf. Der
Endpunkt für die Historie wird **einmal mit einem Spieler sondiert** statt für jeden
Spieler blind durchprobiert — das allein waren bis zu 250 Anfragen pro Lauf.

Ein Lauf kostet damit rund 20 statt 100+ Anfragen.

Alle Importer folgen zusätzlich demselben Muster:

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

**Der Liga-Admin wird gefiltert** (`m.adm !== true`), weil er in der Beispielliga nicht
mitspielt. **Und zwar aus jeder Liste** — er stand zunächst nur nicht in `ids`, wurde aber
weiter an `werBrauchtNeueDaten` gereicht. Dadurch fragte der Lauf seinen Kader ab, den es
nicht gibt, und meldete ihn als „ohne auswertbare Liste". Sobald das Tool an fremde Ligen geht, sollte das eine Einstellung werden — in anderen Ligen kann der Admin durchaus Manager sein.

**Selbstzuordnung:** Erst über `kb_uid` (aus dem Login, Feldname unsicher), dann über `kb_name`. Schlägt beides fehl, wählt der Nutzer sich einmalig aus einer Liste — das ist der zuverlässige Fallback.

**Keine Heuristik ohne Plausibilitätsgrenze.** Die Kalibrierung deutete eine Abweichung
als „so viele Tage Login-Bonus", sobald sie glatt durch 100.000 teilbar war. Transferpreise
sind fast immer glatte Beträge — so kamen „227 Tage Login-Bonus" bei einer Liga heraus, die
20 Tage alt ist. Ein Tagesäquivalent wird jetzt nur genannt, wenn es überhaupt in die
Laufzeit der Liga passt; sonst stehen dort nur die beiden wahrscheinlichen Ursachen
(Login-Bonus, alte Strafe) ohne erfundene Genauigkeit.

**Punkte-Bonus: 1.000 € je Punkt.** Lange stand hier 10.000 € — eine Annahme aus der Zeit, als alle bei `sp: 0` standen und sich nichts prüfen ließ. Der Wert ist inzwischen belegt; bestehende Ligen wurden einmalig mitgezogen (nur die, die noch auf dem alten Wert standen).

**Kadergröße:** Kommt aus `dashboard.t`. Der Wert wirkte mit 48 zu hoch für einen Kader — möglicherweise etwas anderes. Falls die Zahl in Klammern unsinnig aussieht, aus `squad` holen.

---

## Kennzahlen in der Tabelle

- **Kontostand** = berechnetes Guthaben (früher „Liquidität" genannt)
- **Teamwert** = aus `dashboard.tv`, muss separat geladen werden (ein Request je Manager)
- **Spieler** = Kadergröße aus `dashboard.t`
- **Limit** = (Teamwert + Kontostand) × 0,33 = erlaubtes Minus
- **Max-Gebot** = Kontostand + Limit = höchstes Gebot ohne vorherigen Verkauf
- **Gesamtwert** = Kontostand + Teamwert = Gesamtvermögen
- **Liquidität** = Kontostand ÷ Gesamtwert, also der flüssige Anteil des Vermögens.
  Ohne geladenen Teamwert nicht aussagekräftig, steht dann auf „–".
- **MW-Trend** = wie viel die Spieler des Kaders bei der letzten Marktwertanpassung
  zusammen gewonnen oder verloren haben. Siehe eigenen Abschnitt unten.
- **Anpassungen** = Strafen + manuelle Korrektur gebündelt. Die Aufschlüsselung steht in
  der aufgeklappten Detailzeile und auf der Managerseite.

Werte von Managern in einer Liga mit Datenlücke werden mit `~` und `ca.` gekennzeichnet,
die eigene Zeile mit `exakt`.

### Der MW-Trend rechnet Spieler, nicht Teamwerte

Kickbase passt die Marktwerte **täglich um 22:04 deutscher Zeit** an. Die Frage dahinter
ist: Steigen oder fallen die eigenen Leute gerade?

Der frühere Trend verglich zwei gespeicherte **Teamwerte** — und damit rechneten Käufe und
Verkäufe voll mit hinein. Wer für 20 Mio kaufte, stand mit +20 Mio da, ohne dass sich ein
Marktwert bewegt hätte. Das machte die Spalte wertlos.

Gerechnet wird jetzt **je Spieler**: sein Marktwert am jüngsten Marktwert-Tag minus sein
Marktwert am Tag davor, aufsummiert über den aktuellen Kader. Ein Kaufpreis kommt in dieser
Rechnung nirgends vor, ein Transfer kann also nicht hineinregnen.

#### Der Marktwert-Tag beginnt um 22:04, nicht um Mitternacht

Ein um 10:00 abgelesener Marktwert stammt aus der Anpassung des Vorabends und gehört damit
zum Tag davor. `mwTag()` in `lib/format.js` bildet das ab. Ohne diese Verschiebung lägen die
Ablesungen **eines** Tages auf zwei Seiten der Grenze und die Differenz wäre mal 0 und mal
die doppelte Bewegung. Dreizehn Fälle durchgerechnet (`pruefstand/mwtag.mjs`), beide
Zeitumstellungen eingeschlossen.

#### Die Werte kommen aus der eigenen Mitschrift

`kader` wird bei jedem Laden überschrieben und trägt keine Historie. Deshalb schreibt
`ladeKader()` die Marktwerte zusätzlich nach `mw_beobachtung` — ein Eintrag je Spieler und
Marktwert-Tag, zweimal am Tag ablesen überschreibt denselben Eintrag.

**Getrennt von `marktwert_verlauf`, obwohl die Form dieselbe ist.** Dort stehen Kalendertage
aus Kickbases Historie, hier Marktwert-Tage aus eigenen Ablesungen. In einer Tabelle
vermischt lägen die Einträge um bis zu einen Tag versetzt, und der Aufschlag griffe auf den
falschen Bezugswert.

Gezählt wird nur, wer an **beiden** Tagen einen Wert hat. Nach der ersten Aktualisierung
steht der Trend deshalb auf „–“; ab der zweiten am nächsten Marktwert-Tag ist er da. Die
Detailzeile zeigt zusätzlich, wie viele Spieler gestiegen und wie viele gefallen sind —
eine Summe nahe null kann Stillstand sein oder ein Aufheben von Gewinnen und Verlusten.

#### Frische richtet sich jetzt auch nach 22:04

`werBrauchtNeueDaten()` hielt einen Stand für aktuell, solange er nach der letzten
Mitternacht lag. Wer abends nach 22:04 aktualisierte, bekam damit keine neuen Daten — und
genau die Ablesung, aus der der Trend entsteht, fehlte. Bezugspunkt ist jetzt der spätere
von letzter Mitternacht und letzter Marktwertanpassung. Nebenbei behebt das, dass die in
`kader` gespeicherten Marktwerte (mit denen der Verkaufsrechner arbeitet) nach 22:04
veraltet waren.

### Die Gebotsformel steht an einer Stelle

```
erlaubtes Minus = (Mannschaftswert + Kontostand) × 0,33
Max-Gebot       = Kontostand + erlaubtes Minus
```

**Der Kontostand steckt in der Basis mit drin.** Vorher rechnete das Projekt schlicht
`Teamwert ÷ 3` und lag damit bei jedem Manager daneben, dessen Konto nicht bei null steht —
im Minus zu hoch, im Plus zu niedrig. Bei 180 Mio Teamwert und 200 Mio Konto sind das
125,6 Mio statt 60 Mio erlaubtes Minus.

Die Rechnung lag an **sechs Stellen** kopiert vor (Ligaseite, Managerseite, Kauf- und
Verkaufsrechner, Marktseite, Schnappschuss). Sie steht jetzt in `lib/gebot.js` — reine
Rechnung ohne Datenbank, elf Fälle durchgerechnet (`pruefstand/gebot.mjs`), darunter die
Probe aufs Exempel: Wer sein Max-Gebot ausgibt, steht danach genau auf der Grenze.

### Platzierungspfeile

Neben dem Rang steht, wie viele Plätze ein Manager **seit gestern** gutgemacht hat — und
zwar in der Spalte, nach der **gerade sortiert wird**. Ein Pfeil, der sich auf eine andere
Spalte bezöge als die sichtbare Reihenfolge, wäre irreführend.

Grundlage ist `tagesstand`: je Manager und Kalendertag Teamwert, berechneter Kontostand und
Punkte, geschrieben am Ende jedes Aktualisieren-Laufs. Das kostet **keinen einzigen
Kickbase-Aufruf** — alles steht schon in der Datenbank.

Verglichen wird gegen den **jüngsten Stand vor heute**, nicht stur gegen gestern: Wer zwei
Tage nicht aktualisiert hat, soll trotzdem einen Vergleich bekommen. Wer gestern noch nicht
dabei war, bekommt keinen Pfeil.

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

### Die Managerseite öffnet als Schublade

Ein Klick auf einen Managernamen in der Tabelle schiebt dessen Seite von rechts über die
Liga, statt die Seite zu wechseln — man verliert seine Stelle in der Tabelle nicht.

Gebaut über **parallele und abfangende Routen** (`app/liga/@panel/(.)manager/[id]`). Der
Inhalt wird dabei **nicht kopiert**: Die Schublade rendert dieselbe Managerseite und teilt
ihr über `imPanel` nur mit, dass sie ohne Seitenrahmen und ohne „zurück zur Liga"
auskommt. Ein direkter Aufruf derselben Adresse (Neuladen, geteilter Link) zeigt
unverändert die vollständige Seite.

**Geschlossen wird über die Verlaufsgeschichte** (`router.back()`), nicht über einen
eigenen Zustand. Dann schließt auch der Zurück-Knopf des Browsers die Schublade, statt die
Ligaseite zu verlassen. Escape und ein Klick daneben tun dasselbe; der Klick daneben wird
beim `mousedown` geprüft, damit eine Textauswahl, die im Inhalt beginnt und draußen endet,
nicht zuklappt.

Solange die Schublade offen ist, wird das Scrollen der Seite darunter gesperrt.

### Wahrscheinliche Aufstellung

Vorbelegt ist die **echte Aufstellung aus Kickbase**.

#### Es gibt einen eigenen Endpunkt — belegt, nicht geraten

```
/v4/leagues/{id}/lineup
→ { it: [ { i, n, ap, lo, st, lst, mdst, tid, pos, os } ] }
```

`lo` ist die Position in der Aufstellung. **Das ist die Quelle**, und sie schlägt jede
Felderkennung. Gefunden über die Diagnoseseite `/aufstellung`; die drei Varianten
`/managers/{uid}/lineup`, `/lineup/{uid}` und `/teamcenter` antworteten nicht.

**Elf ist die Obergrenze, nicht die Regel.** Wer seine Aufstellung nicht fertig gemacht
hat, steht mit zehn oder weniger da. Eine Erkennung, die auf „genau elf" besteht, liefert
dann gar nichts.

Beim **Endpunkt** ist das unkritisch — er liefert die Aufstellung, dort wird gelesen und
nicht bewiesen. Bei der **Felderkennung** ist die Zahl dagegen der ganze Beweis: Je weiter
man sie öffnet, desto eher passt ein beliebiges Feld zufällig. Dort gilt deshalb eine
Untergrenze von **sieben** — weniger ist unrealistisch, und ein Fehlalarm wäre schlimmer
als eine fehlende Anzeige.

Fällt **mehr als eine Gruppe** in den erlaubten Bereich (bei 18 Spielern sind elf
Aufgestellte und sieben auf der Bank beide „höchstens elf"), entscheidet die Position: Wer
aufgestellt ist, hat die kleinste. Gibt es kein Positionsfeld, gewinnt die größere Gruppe.

Die Startelf wird auf drei Wegen gesucht, der erste passende gewinnt:
ein **Statusfeld** (`lst`, `st`, …), bei dem ein Wert genau elfmal vorkommt; die **Position
`lo`**; oder eine Liste, die schon genau elf Einträge hat.

**Der Zahlenbereich von `lo` wird abgelesen, nicht geraten.** Gezählt wird die lückenlose
Folge ab dem kleinsten Wert, höchstens elf lang — bricht sie vorher ab, sind eben nur so
viele aufgestellt. Fest auf 1–11 zu filtern hat
einen Ersatzspieler hereingelassen und den mit `lo: 0` verworfen — bei einer Aufstellung
ist das typischerweise der Torwart. Gezählt werden jetzt elf aufeinanderfolgende Positionen
**ab dem kleinsten vorkommenden Wert**, also 0–10 oder 1–11.

**Ein Endpunkt, der die `uid` ignoriert, wird erkannt.** Kommt bei jedem Manager dieselbe
Elf zurück, sähe das sonst nach 17 Erfolgen aus, obwohl nur ein einziger Manager Daten
bekommt. Der Lauf vergleicht die Elfen und schreibt dann ausdrücklich „Kickbase gibt fremde
Aufstellungen nicht heraus".

**Die Aufstellung ist ein eigener Schritt im Aktualisieren-Lauf**, nicht an den Kader
gehängt. Sie ändert sich, wenn der Manager sie ändert — unabhängig von Transfers und
Marktwertanpassung. Zuerst hing sie im Kader-Zweig und wurde deshalb übersprungen, sobald
die Kader schon aktuell waren: Genau dann stand überall „keine Aufstellung erkennbar",
obwohl der Endpunkt einwandfrei antwortet.

**Für wen der Endpunkt antwortet, muss man nicht wissen.** Die zurückgegebenen Spieler-IDs
werden dem Manager zugeordnet, in dessen gespeichertem Kader sie stehen — wer die Spieler
hat, hat die Aufstellung. Ob es eine Fassung je Manager gibt, entscheidet der erste
Versuch: Greift eine Variante mit `uid`, wird jede Aufstellung einzeln geholt; sonst gibt
es genau einen Abruf.

#### Die Felderkennung bleibt als Rückfall

Schweigt der Endpunkt, wird im Kader gesucht: ein Feld, das **genau elf** Spieler
auszeichnet, in drei Mustern.

| Muster | Form | Beispiel |
|---|---|---|
| **Reihenfolge** | 1–11 für die Startelf, danach die Bank | `lineup_order: 1…18` |
| **Wahrheitswert** | genau elf `true` | `inLineup: true/false` |
| **Status-Code** | wenige Werte, einer kommt genau elfmal vor | `lineup_status: 1/2/0` |

**Die erste Fassung kannte nur eine Mischform** und verlangte, dass alle übrigen Spieler
„leer, false oder 0" sind. Damit scheiterte sie an den beiden wahrscheinlichsten Formen:
Eine durchnummerierte Bank (12–18) ist nicht „aus", und ein Status 2 für die Bank zählte
fälschlich als markiert — 18 Treffer statt 11, also verworfen.

Felder, deren Bedeutung wir kennen (Position, ID, Marktwert, Preis, Punkte, Name), sind
**gesperrt**. 23 Fälle durchgerechnet (`pruefstand/aufstellung.mjs`).

Der Aktualisieren-Lauf meldet, **woher** die Aufstellung kommt („Aufstellung 3 Manager"
oder „… aus dem Kader über `lineup_order`") oder dass nichts erkennbar war.
`/aufstellung?league=…` beantwortet die eigentliche Frage: **Kommen fremde Aufstellungen
durch?** Ein Endpunkt, der *antwortet*, beweist nämlich nichts — `/lineup?uid=…` antwortet
für jeden Manager und liefert trotzdem immer die eigene Elf. Die Seite ruft deshalb jeden
Kandidaten für **zwei verschiedene Gegner** auf und vergleicht; entscheidend ist die Spalte
„verschieden". Dazu die Rohdaten und je Feld, was auffällt.

Ein Knopf **„Echte Aufstellung"** holt sie zurück, und die Leiste sagt, woran man ist:
„wie in Kickbase aufgestellt" oder „geändert".

Auf der Managerseite lassen sich **elf Spieler** wählen; sie erscheinen positionsgetreu auf
einem Platz — Sturm oben, Tor unten, so wie man eine Aufstellung liest. Darunter steht das
System (`4-3-3`), der Gesamtmarktwert und die Punktsumme.

Der Kader ist deshalb **nach Position vorsortiert** (`posRang` in `lib/format.js`): Tor,
Abwehr, Mittelfeld, Sturm. Alphabetisch käme ABW, ANG, MF, TW heraus — für einen Kader
unbrauchbar.

**Die Positionsspalte kippt nicht.** Jede andere Spalte dreht beim zweiten Klick die
Richtung um; die Position kennt nur eine sinnvolle Reihenfolge. Umgedreht finge die Liste
beim Sturm an — so liest niemand einen Kader. Deshalb trägt diese Spalte auch keinen
Richtungspfeil.

Der Platz ist **kein Bild**, sondern vier Reihen mit Verlauf und Linien. Eine echte
Spielfeldgrafik bräuchte Assets und trüge zur Aussage nichts bei.

**Die Auswahl wird nicht gespeichert.** Ein Wiederherstellen aus dem `localStorage` müsste
beim ersten Rendern greifen — dann steht auf dem Server etwas anderes als im Browser und
die Seite hydriert mit einem Konflikt. Für ein Gedankenspiel ist das den Preis nicht wert.

### Der Aufschlag braucht den Marktwert von damals

Kaufpreis minus Marktwert **zum Kaufzeitpunkt**. Drei Quellen, in dieser Reihenfolge:

1. Feed-Event Typ 3 („Spieler neu am Markt") — trägt `mv` mit
2. Die eigene Mitschrift des Live-Markts
3. Die **Marktwert-Historie** des Spielers (`marktwert_verlauf`)

Die dritte kam nach, weil die ersten beiden nur Käufe abdecken, deren Angebot noch im
Feed-Fenster liegt: Ein Manager mit 11 Spielern erschien mit 7 Käufen. Gesucht wird der
Wert des Kauftags, sonst der letzte davor.

Welcher Endpunkt die Historie liefert, ist **nicht belegt**. `ladeMarktwertVerlauf()`
probiert Kandidaten durch und `findeWertreihe()` sucht in der Antwort die längste Reihe aus
Datum und Wert, statt Feldnamen zu raten — geprüft gegen `dt/mv`, `d/m`, `date/value`,
`t/v`, verschachtelte Objekte, Sekunden- und Millisekunden-Zeitstempel. Unplausible Daten
(etwa ein Tagesindex 1, 2, 3) werden verworfen.

`marktwert_geprueft` merkt sich, wen wir schon gefragt haben — sonst würde jeder Lauf
dieselben Spieler ohne Historie erneut abfragen.

Die Suche nach dem Endpunkt läuft **schrittweise und konvergiert**: vier Kandidaten je
Lauf, mit Gedächtnis darüber, was schon probiert wurde. Nach drei Läufen ist die Liste
durch, und dann hört sie endgültig auf. Vorher probierte jeder Lauf alle zehn erneut —
zehn vergebliche Aufrufe pro Klick, für immer. Im Kommentar stand „nicht weiter probieren",
im Code nicht.

**Gesperrt wird aber erst, wenn ein funktionierender Endpunkt bekannt ist** (er steht in
`pool_cache` unter `mw_pfad`). Liefert kein Kandidat etwas, liegt es nicht am Spieler,
sondern daran, dass wir nicht wissen, wie man fragt — dann wären die Sperren falsch und
würden die Spieler tagelang blockieren. Solange kein Pfad bekannt ist, werden alte Sperren
beim nächsten Lauf gelöscht. Genau das ist einmal passiert: „Marktwerte 0/25", und danach
tat jeder weitere Klick nichts mehr.

`/marktwert?league=…` probiert alle Kandidaten durch und sagt für jeden, ob sich eine Reihe
aus Datum und Wert darin findet — erst danach wird implementiert.

### Kaufrechner

Auf `/liga/markt` und `/liga/transfermarkt` lassen sich Spieler anklicken; oben steht
sofort, was der Kauf mit dem eigenen Konto macht. `app/_ui/Kaufrechner.jsx` ist derselbe
Baustein für beide Seiten.

Beide Richtungen stehen dort zusammen, weil ein Kauf meist daran hängt, dass vorher etwas
raus muss: Unter dem Rechner lässt sich der **eigene Kader** aufklappen und Spieler zum
Verkauf antippen. Zwei Regler, weil beide Richtungen ihre eigene Unsicherheit haben — beim
Kauf bietet man über den Marktwert, beim Verkauf an Kickbase bekommt man genau ihn und bei
einem Mitspieler womöglich mehr.

Zwei Dinge, die man leicht falsch rechnet:

- **Käufe und Verkäufe verschieben das erlaubte Minus.** Ein gekaufter Spieler zählt zum Teamwert, und
  das Limit ist Teamwert ÷ 3. Wer für 20 Mio kauft, darf danach rund 6,7 Mio tiefer ins
  Minus als vorher. Ohne diesen Schritt fiele die Rechnung zu pessimistisch aus.
- **Zum Marktwert bekommt man selten jemanden.** Deshalb ein Regler von 0 bis 50 %
  Aufschlag. Der auf der Ligaseite gemessene Liga-Schnitt lässt sich per Klick übernehmen.

Maßgeblich ist nicht der Kontostand danach, sondern die **Luft bis zur Grenze**
(Kontostand + Limit). Sie darf nicht negativ werden.

### Die Tabelle steht oben

Sie ist das Werkzeug, wegen dem man die Seite aufruft — alles andere ist Beleg
und Beiwerk. Die Reihenfolge auf der Ligaseite ist deshalb: **Tabelle, dann**
Statusleiste, Kalibrierung, Teamwert-Verlauf, Frag die Liga.

Zwei Dinge bleiben trotzdem darüber, und zwar aus einem Grund:

- Die **Rückmeldung auf einen Klick** („12 neue Events importiert") gehört unter den
  Knopf, der sie ausgelöst hat. Stünde sie unter der Tabelle, müsste man nach dem
  Aktualisieren erst scrollen, um zu sehen, ob es geklappt hat.
- Die **Datenlücken-Warnung** erklärt die `~`-Werte in der Tabelle. Darunter käme
  sie zu spät.

Die **Aufschläge haben eine eigene Seite** (`/liga/aufschlaege`). Sie bringen zwei
eigene Filter mit (Herkunft, Zeitraum), belegten damit die URL der Ligaseite und
schoben die Tabelle nach unten.

### Aufschläge: Herkunft trennen, Abdeckung zeigen

Zwei Dinge machten die erste Fassung der Tabelle wertlos:

**Marktkäufe und Deals zwischen Mitspielern liefen in denselben Durchschnitt.** Am Markt
bietet man über den Marktwert, um den Zuschlag zu bekommen; bei einem Mitspieler wird
verhandelt, und der Preis hat mit dem Marktwert oft wenig zu tun. Ein einziger solcher Deal
hebt den Schnitt eines Managers von 15 % auf 43 %. Umschaltbar über `?her=` (Vorgabe:
`markt`), unterschieden am `seller` des Transfers.

**Die Spalte „Käufe" zeigte nur die bewerteten.** Ein Manager mit 7 bewerteten von 11 stand
neben einem mit 22 von 22, als wären die Zahlen vergleichbar. Jetzt steht dort „7 von 11".

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

Fehlt ein Bild, steht dort **nichts** — kein Platzhalterkreis. Eine leere Scheibe vor jedem
Namen sagt nichts aus und stiehlt nur Platz.

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

**Der Prüfstand achtet auch auf Konsolenfehler.** Er hörte lange nur auf abgestürzte
Skripte. React meldet ungültiges HTML und Hydrierungskonflikte aber über `console.error` —
ein `<dialog>` in einem `<p>` (in `Frag.jsx`) blieb deshalb lange unbemerkt.

**`pruefstand/seiten.js` vor dem Ausliefern.** Der Build sagt nur, ob der Code übersetzt —
nicht, ob die Seite läuft. Drei Ausfälle in Folge kamen genau daher. Der Prüfstand rendert
jede Seite gegen ein echtes Postgres, mit abgeklemmtem Kickbase (`NODE_OPTIONS=--require
pruefstand/kickbase-attrappe.cjs`, es geht kein echter Aufruf raus). Er fängt, was Build und
Linter nicht sehen können — allen voran falsche Spaltennamen in SQL. Anleitung in
`pruefstand/README.md`.

**`npm run lint` vor jedem Commit.** In `eslint.config.mjs` ist `no-undef` aktiv, und zwar
aus konkretem Anlass: Eine Textersetzung an einer Import-Zeile griff nicht, die Ligaseite
benutzte danach fünf Funktionen ohne Import, der Build lief trotzdem durch — JavaScript
meldet einen unbekannten Bezeichner erst beim Aufruf. Live antwortete die Seite mit einem
Serverfehler. Die Regel hat anschließend zwei weitere Fundstellen aufgedeckt, von denen
niemand wusste.

Seit demselben Anlass ist auch `no-use-before-define` aktiv: Eine Zeile las eine Größe,
bevor sie berechnet war, und die Managerseite starb mit einem ReferenceError. `no-undef`
sieht das nicht — die Variable existiert ja, nur später.

Daraus zwei Regeln für Textersetzungen im Quelltext:

- **Jede Ersetzung einzeln absichern.** Nicht eine von zweien prüfen und annehmen, dass die
  andere auch gegriffen hat.
- **Keine gierigen Regex über Zeilengrenzen.** `[^,]+` frisst Zeilenumbrüche und hat sich
  einmal quer durch eine SQL-Abfrage gefressen. Exakte Zeichenketten sind sicherer.

**Fehler an ihrer Ursache unterscheiden, nicht am Wortlaut.** `kbFetch` setzt `status` am
Fehlerobjekt — daran erkennt man einen Fehler des Endpunkts. Ein Versuch, das über
`/HTTP \d+/` am Meldungstext zu prüfen, ging schief, weil die Meldung `API-Fehler: 404`
lautet: Jeder 404 galt damit als eigener Fehler und riss den ganzen Aktualisieren-Lauf mit.

Bei Unsicherheit über einen Endpoint oder ein Datenformat: **erst eine Diagnose-Seite bauen, die mehrere Kandidaten durchprobiert, dann implementieren.** So sind alle bisherigen Erkenntnisse entstanden. Raten hat in diesem Projekt mehrfach zu Fehlern geführt, die erst durch die Kalibrierung auffielen — oder gar nicht, weil sie nur Gegner betrafen.

Alles auf Deutsch: UI, Variablennamen, Kommentare.
