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
kader(league_id, manager_id, player_id, name, position, marktwert, kaufpreis, punkte, stand)
  + Index (league_id)                                 -- PK (league_id, manager_id, player_id)
```

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

### Tabelle auf schmalen Displays

Sichtbar bleiben **Gesamtwert, Max-Gebot, Liquidität** — die drei Zahlen, mit denen man
Manager vergleicht. Teamwert, Limit, Strafen, Korrektur und Punkte wandern in eine
Detailzeile, die das `+` vor dem Namen aufklappt. Dort stehen **alle** Werte ausgeschrieben,
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
  liga/Frag.jsx                    "use client" — Fragen an ein LLM, Schlüssel im Browser
  api/frag/route.js                Frage → Antwortstrom
  api/modelle/route.js             Modellliste beim Anbieter erfragen
  api/aktualisieren/route.js       Feed, Teamwerte, Kader, Historie in einem Lauf
  _diagnose/Endpunkte.jsx          gemeinsamer Baustein der Diagnose-Seiten
  api/kader/route.js               Kader aller Manager laden
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
  rekonstruktion.js rekonstruiere(), holeSpielerPool()
  anbieter.js       frageStream(), holeModelle() — Claude, ChatGPT, Gemini
  auth.js           sitzung(), istMitglied(), verlangeLiga(), pruefeApi() — Zugriffsschutz
  kader.js          ladeKader() — Kader je Manager
  ledger.js         loginBonus(), berechneKonten() — das Herzstück
  schnappschuss.js  baueSchnappschuss() — Datensatz für die Frage-Funktion
  teamwerte.js      ladeTeamwerte()
  format.js         euro, euroKurz, prozent, zeitpunkt, vorZeit, restzeit, position,
                    normalisiereSpieler, findeSpielerListe
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

---

## Bekannte Eigenheiten

**Manager werden über Anzeigenamen identifiziert, nicht über IDs.** Der Feed liefert `byr: "Lamlo"`, keine ID. Bei Namensänderung bricht die Zuordnung. Doppelte Namen werden in der UI markiert.

**Der Liga-Admin wird gefiltert** (`m.adm !== true`), weil er in der Beispielliga nicht mitspielt. Sobald das Tool an fremde Ligen geht, sollte das eine Einstellung werden — in anderen Ligen kann der Admin durchaus Manager sein.

**Selbstzuordnung:** Erst über `kb_uid` (aus dem Login, Feldname unsicher), dann über `kb_name`. Schlägt beides fehl, wählt der Nutzer sich einmalig aus einer Liste — das ist der zuverlässige Fallback.

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
- **Anpassungen** = Strafen + manuelle Korrektur gebündelt. Die Aufschlüsselung steht in
  der aufgeklappten Detailzeile und auf der Managerseite.

Werte von Managern in einer Liga mit Datenlücke werden mit `~` und `ca.` gekennzeichnet,
die eigene Zeile mit `exakt`.

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
