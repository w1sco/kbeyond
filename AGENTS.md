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
```

`initSchema()` ist idempotent und läuft bei jedem Seitenaufruf. Schemaänderungen dort ergänzen, für neue Spalten `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` verwenden.

### Einstellungen nicht überschreiben

In `app/liga/page.js` werden `startbudget` und `stichtag` mit `COALESCE` vorbelegt — nur wenn leer. **Das muss so bleiben.** Eine frühere Version hat sie bei jedem Aufruf mit `overview.b`/`overview.dt` überschrieben und damit jede manuelle Korrektur des Nutzers stillschweigend verworfen.

Übrigens: `overview.dt` ist **nicht** der Reset-Zeitpunkt. Was es genau ist, ist unklar. Der echte Reset muss manuell gesetzt werden.

---

## Dateien

```
app/
  login/page.js                    Client-Komponente, Login-Formular → /liga
  liga/page.js                     Hauptseite: Auswahl, Kalibrierung, Status, Datenlücke
  liga/Tabelle.jsx                 "use client" — sortierbar, Namensspalte sticky
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
  ledger.js         loginBonus(), berechneKonten() — das Herzstück
  teamwerte.js      ladeTeamwerte()
  format.js         euro, zeitpunkt, vorZeit, restzeit, position, normalisiereSpieler
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

- **Liquidität** = berechneter Kontostand
- **Teamwert** = aus `dashboard.tv`, muss separat geladen werden (ein Request je Manager)
- **Limit** = Teamwert ÷ 3 = erlaubtes Minus
- **Max-Gebot** = Liquidität + Limit = höchstes Gebot ohne vorherigen Verkauf
- **Gesamtwert** = Liquidität + Teamwert = Gesamtvermögen

Werte von Managern in einer Liga mit Datenlücke werden mit `~` und `ca.` gekennzeichnet, die eigene Zeile mit `exakt`.

---

## Nächste Schritte

1. **Mobile Responsiveness.** Blocker: Inline-Styles können keine Media Queries. Braucht eine CSS-Datei mit Breakpoints. Erst prüfen, ob in `app/layout.js` ein Viewport-Meta gesetzt ist. Für die Tabelle war der Plan: auf schmalen Displays nur Gesamtwert, Max-Gebot und Liquidität, Rest aufklappbar — Vergleichbarkeit zwischen Managern ist wichtiger als Lesbarkeit einer Einzelzeile.
2. Nach dem ersten Spieltag den Punkte-Bonus verifizieren.
3. Admin-Filter zur Einstellung machen.
4. Gegnerkader-Ansicht und Bietrechner (wer braucht welche Position, wer kann mitbieten).

---

## Arbeitsweise

Der Nutzer arbeitete bisher über die GitHub-Weboberfläche, deshalb wurden **immer vollständige Dateien** geliefert, nie Ausschnitte. Fast alle Build-Fehler entstanden durch abgeschnittene oder doppelt eingefügte Blöcke beim Copy-Paste.

Bei Unsicherheit über einen Endpoint oder ein Datenformat: **erst eine Diagnose-Seite bauen, die mehrere Kandidaten durchprobiert, dann implementieren.** So sind alle bisherigen Erkenntnisse entstanden. Raten hat in diesem Projekt mehrfach zu Fehlern geführt, die erst durch die Kalibrierung auffielen — oder gar nicht, weil sie nur Gegner betrafen.

Alles auf Deutsch: UI, Variablennamen, Kommentare.
