# KBeyond — was die Anwendung kann

Diese Beschreibung ist so gehalten, dass sich die Anwendung damit in einem
anderen System nachbauen lässt. Sie beschreibt **was** passiert und **nach
welchen Regeln**, nicht wie es programmiert ist.

---

## 1. Wozu das Ganze

Kickbase ist ein Bundesliga-Managerspiel. Jeder Mitspieler hat ein Budget,
kauft und verkauft Spieler und sammelt Punkte.

**Das Problem:** Kickbase zeigt jedem nur den *eigenen* Kontostand. Von den
Gegnern sieht man Teamwert, Punkte und Kader — aber nicht, wie viel Geld sie
haben. Damit weiß man nie, wer bei einem Spieler mitbieten kann.

**Die Lösung:** Der Kontostand jedes Mitspielers lässt sich aus dem
Liga-Aktivitätsfeed rekonstruieren, denn dort steht jeder Kauf und Verkauf mit
Preis und Name. Die Anwendung rechnet das für alle Manager nach und baut darauf
Werkzeuge für Kauf- und Verkaufsentscheidungen.

---

## 2. Grundbegriffe

| Begriff | Bedeutung |
|---|---|
| **Liga** | Eine Gruppe von Managern, die gegeneinander spielen |
| **Manager** | Ein Mitspieler der Liga |
| **Kader** | Die Spieler, die einem Manager gehören |
| **Marktwert (MW)** | Der von Kickbase festgelegte Wert eines Spielers, ändert sich täglich |
| **Teamwert** | Summe der Marktwerte aller Spieler eines Kaders |
| **Transfermarkt** | Wo Spieler angeboten werden — von Kickbase oder von Mitspielern |
| **Stichtag** | Der Zeitpunkt, an dem die Liga zurückgesetzt wurde. Alles davor zählt nicht |
| **Liga-Reset** | Der Neustart einer Liga: alle Kader werden aufgelöst, jeder beginnt mit dem Startbudget |

---

## 3. Woher die Daten kommen

Alle Ligadaten stammen aus der (inoffiziellen) Kickbase-Schnittstelle. Der
Nutzer meldet sich mit seinen Kickbase-Zugangsdaten an; damit werden in seinem
Namen Daten gelesen. **Es wird nie etwas bei Kickbase verändert.**

Verfügbar sind unter anderem:

- **Eigene Ligen** — welche Ligen der Nutzer hat
- **Ligaübersicht** — Startbudget der Liga
- **Eigener Kontostand** — der echte Wert des angemeldeten Nutzers
- **Rangliste** — alle Manager mit Punkten, Teamwert, Platz
- **Aktivitätsfeed** — die Ereignisliste der Liga (siehe unten)
- **Transferhistorie je Spieler** — reicht Jahre zurück
- **Kader je Manager** — Spieler mit Kaufpreis, Marktwert, Punkten
- **Aktueller Transfermarkt** — was gerade angeboten wird
- **Vereinskader** — alle Spieler der 18 Bundesligavereine

### Der Aktivitätsfeed

Jeder Eintrag hat einen Typ. Fünf sind wichtig:

| Typ | Bedeutung | Geld? | Enthält |
|---|---|---|---|
| **Transfer** | Ein Spieler wechselt | **ja** | Käufer, Verkäufer, Preis, Spieler |
| **Neu am Markt** | Ein Spieler wird angeboten | nein | Spieler, Marktwert zu dem Zeitpunkt |
| **Login-Bonus** | Tägliche Gutschrift | ja | Betrag, Streak-Tag |
| **Meilenstein** | Auszeichnung | **nein** | — |
| **Strafe** | Abzug wegen Regelverstoß | **ja** | Betrag (negativ), Managername |

**Transferlogik** — drei Fälle, eine Regel:

- Käufer *und* Verkäufer vorhanden → Handel zwischen zwei Managern
- nur Käufer → Kauf vom Markt, das Geld verlässt die Liga
- nur Verkäufer → Verkauf an Kickbase, das Geld entsteht

```
wenn Käufer:    Konto[Käufer]    −= Preis
wenn Verkäufer: Konto[Verkäufer] += Preis
```

### Die wichtigste Einschränkung

**Der Feed liefert nur die letzten ~670 Einträge.** Ältere Ereignisse sind
nicht mehr abrufbar. Deshalb gilt:

1. Die eigene Datenbank ist ein **Archiv**: Einmal Importiertes bleibt
   erhalten, auch wenn Kickbase es nicht mehr ausliefert. Wer regelmäßig
   aktualisiert, hat die Lücke langfristig nicht.
2. Für die Vergangenheit lässt sich ein Teil über die **Transferhistorie je
   Spieler** nachladen (siehe Abschnitt 5).
3. **Strafen aus der Lücke sind unwiederbringlich** — sie hängen an keinem
   Spieler und existieren nur im Feed. Der Liga-Admin kann sie einsehen; die
   Beträge trägt man dann von Hand als Korrektur ein.

---

## 4. Die Kernrechnung: Kontostand

Für jeden Manager:

```
Kontostand = Startbudget
           + Login-Bonus
           + Punkte × Punkte-Bonus
           + Summe aller Verkaufserlöse
           − Summe aller Kaufpreise
           + Summe der Strafen        (Beträge sind bereits negativ)
           + manuelle Korrektur
```

Gezählt wird nur, was **nach dem Stichtag** passiert ist.

### Die Kalibrierung — das wichtigste Werkzeug

Für den angemeldeten Nutzer liefert Kickbase den **echten** Kontostand. Die
Anwendung zeigt beide Werte nebeneinander:

- **Berechnet** (nach obiger Formel)
- **Echt** (von Kickbase)
- **Differenz**

Steht die Differenz auf **0 €**, ist die Formel bewiesen — und gilt dann für
alle Manager gleichermaßen. Das ist der einzige harte Beleg dafür, dass die
Zahlen stimmen. Diese Anzeige gehört zwingend dazu.

**Grenze der Kalibrierung:** Sie beweist die Formel nur für den eigenen
Datensatz. Ein Fehler, der nur Gegner betrifft (fehlende Strafen, fehlende
Transfers aus Zeiträumen, in denen man selbst nicht gehandelt hat), bleibt
unsichtbar.

**Bei einer Differenz** nennt die Seite die zwei wahrscheinlichen Ursachen
(Login-Bonus, alte Strafe) — aber **keine erfundene Genauigkeit**. Frühere
Versionen deuteten jede glatt durch 100.000 teilbare Differenz als „X Tage
Login-Bonus"; da Transferpreise fast immer glatt sind, kam dabei Unsinn heraus
("227 Tage" in einer 20 Tage alten Liga). Ein Tagesäquivalent darf nur genannt
werden, wenn es überhaupt in die Laufzeit der Liga passt.

---

### Erlaubtes Minus und Max-Gebot

```
erlaubtes Minus = (Mannschaftswert + Kontostand) × 0,33
Max-Gebot       = Kontostand + erlaubtes Minus
```

**Der Kontostand steckt in der Basis mit drin** — nicht nur der Mannschaftswert.
Eine Rechnung mit `Teamwert ÷ 3` liegt bei jedem Manager daneben, dessen Konto
nicht bei null steht: im Minus zu hoch, im Plus zu niedrig.

Lesart: Das erlaubte Minus ist der Betrag, den man nach einem angenommenen
Gebot maximal im Minus stehen darf. Wer bietet, hat danach `Konto − Gebot`; das
muss über `−erlaubtes Minus` bleiben.

Bei einem Gesamtvermögen unter null bleibt das erlaubte Minus bei null — ein
negatives „erlaubtes Minus" ergibt keinen Sinn.

---

## 5. Die Datenlücke schließen

Die Transferhistorie **je Spieler** reicht Jahre zurück und umgeht damit die
670er-Grenze. Daraus lassen sich alte Transfers rekonstruieren.

**Spielerpool** — für wen die Historie geholt wird, kommt aus zwei Quellen:

1. Alle Spieler der 18 Bundesligavereine
2. **Alle Spieler-IDs, die bereits in gespeicherten Ereignissen vorkommen** —
   das erwischt Spieler, die heute in keinem Bundesligakader mehr stehen

Punkt 2 ist wichtig: Ein Kauf fehlte, weil der Spieler die Liga verlassen
hatte und im Vereinskader nicht mehr auftauchte — bekannt war er nur über sein
späteres Verkaufs-Ereignis.

**Überlappungsfreiheit:** Rekonstruiert werden **ausschließlich Transfers, die
zeitlich vor dem ältesten echten Feed-Eintrag liegen.** Das ist die einzig
verlässliche Duplikatvermeidung.

> Nicht über „Fingerabdrücke" (Spieler + Minute) deduplizieren. Das wurde
> versucht und erzeugte 88 Duplikate: Feed und Historie stempeln denselben
> Vorgang unterschiedlich, und ein Transfer kann nach dem Rekonstruktionslauf
> noch per Feed nachkommen.

Rekonstruierte Einträge werden als solche gekennzeichnet, damit sie einzeln
gelöscht werden können.

---

## 6. Der Login-Bonus

Wer sich täglich einloggt, bekommt eine Gutschrift. Die Staffelung:

- Tag 1: 10.000 €, Tag 2: 20.000 € … jeden Tag 10.000 € mehr
- **Ab Tag 10 konstant 100.000 €**
- Bei Unterbrechung beginnt die Staffelung wieder bei 10.000 €

```
Summe bis Tag n:   n < 10  →  n × (n+1) / 2 × 10.000
                   n ≥ 10  →  450.000 + (n − 9) × 100.000
Wert eines Tages:  Summe(n) − Summe(n−1)
```

### Drei Fallstricke

**1. Gezählt werden Mitternachte, keine 24-Stunden-Blöcke.** Die Gutschrift
kommt um **0:00 Uhr** für den neuen Tag. Maßgeblich sind Kalendertage. Eine
Rechnung mit „verstrichene Zeit ÷ 24 h" springt zur Uhrzeit des Startpunkts
und liegt dazwischen einen ganzen Tag daneben.

**2. Zwei Zähler, die man nicht verwechseln darf.** Der Streak-Tag im Ereignis
ist **kontoweit** (über alle Ligen gleich), der ausgezahlte Betrag folgt aber
einer **ligaeigenen** Staffelung, die beim Liga-Reset neu startet. Belegt:
gleicher Streak-Tag, unterschiedliche Beträge in zwei Ligen.

**3. Timing-Falle beim Reset.** Lag der Liga-Reset später am Tag als 0:00
(Beispiel 0:48), verfiel die Gutschrift für alle, die vorher schon in der App
waren. Diese Nutzer liegen dauerhaft einen Tag zurück — im konstanten Bereich
sind das 100.000 €, die sich nie aufholen. Das wird über eine manuelle
Korrektur ausgeglichen, nicht im Code.

> Den Streak-Beginn **nicht** aus vorhandenen Bonus-Ereignissen ableiten. Die
> frühen Gutschriften liegen außerhalb des Feed-Fensters (sie kommen nachts,
> das Fenster endet mittags) — es fehlt genau der Anfang.

---

## 7. Die Seiten im Einzelnen

### 7.1 Anmeldung

- E-Mail und Passwort werden an Kickbase weitergereicht und **nicht
  gespeichert**. Abgelegt wird nur das Sitzungs-Token.
- Ankreuzfeld **„Angemeldet bleiben"**, vorbelegt: ja.
  - angehakt → lange Sitzung
  - nicht angehakt → Sitzung endet mit dem Schließen des Browsers
- Kickbase kennt selbst ein Kennzeichen für „angemeldet bleiben" — das muss
  beim Login mitgeschickt werden, sonst bekommt man immer die kurze Sitzung.
- Die **Gültigkeitsdauer wird aus dem Token selbst gelesen**, nicht geraten,
  und die Sitzung genau so lang gehalten. Ein Cookie, das ein totes Token
  trägt, sieht aus wie „angemeldet" und ist es nicht.
- Läuft die Sitzung ab, führt **jeder** Einstieg zurück zur Anmeldung mit der
  Meldung „Sitzung abgelaufen" — nicht zu einer Fehlerseite.

### 7.2 Ligaauswahl

Kacheln mit allen Ligen des Nutzers, je Liga Name, Budget und Teamwert.

### 7.3 Ligaseite — die Haupttabelle

**Die Tabelle steht ganz oben.** Sie ist das Werkzeug, wegen dem man die Seite
aufruft; Statusanzeigen, Kalibrierung und Diagramme stehen darunter.

Eine Zeile je Manager, sortierbar nach jeder Spalte:

| Spalte | Bedeutung |
|---|---|
| **Gesamtwert** | Kontostand + Teamwert |
| **Max-Gebot** | Kontostand + Limit — das höchste Gebot ohne vorherigen Verkauf |
| **Kontostand** | Das berechnete Guthaben |
| **Liquidität** | Kontostand ÷ Gesamtwert, also der flüssige Anteil des Vermögens |
| **Teamwert** | Summe der Marktwerte des Kaders |
| **MW-Trend** | Marktwertbewegung des Kaders bei der letzten Anpassung (siehe 7.4) |
| **Spieler** | Kadergröße = Käufe − Verkäufe |
| **Limit** | (Teamwert + Kontostand) × 0,33 = das erlaubte Minus |
| **Anpassungen** | Strafen und manuelle Korrektur gebündelt |
| **Punkte** | Saisonpunkte |

- Der **Managername führt zur Managerseite** — als Schublade von rechts, ohne
  die Tabelle zu verlassen. Ein direkter Aufruf der Adresse zeigt die volle Seite.
- **Platzierungspfeile** neben dem Rang: wie viele Plätze seit gestern
  gutgemacht, **bezogen auf die gerade sortierte Spalte**. Ein Pfeil, der sich
  auf eine andere Spalte bezöge als die sichtbare Reihenfolge, wäre irreführend.
- Werte in einer Liga mit Datenlücke werden mit `~` und „ca." gekennzeichnet,
  die eigene Zeile mit „exakt".
- **Doppelte Anzeigenamen werden markiert** (siehe Fallstricke).

**Auf schmalen Displays** ist Platz für den Namen und drei Zahlen.
Gesamtwert und Kontostand stehen fest, der dritte Platz gehört der Spalte,
nach der gerade sortiert wird — sonst ordnet ein Tippen auf „Trend" die Zeilen
zwar richtig, zeigt aber nirgends einen Trend. Alle übrigen Werte stehen in
einer aufklappbaren Detailzeile.

Darunter auf derselben Seite:

- **Statusleiste**: letzte Aktualisierung, wie weit der Feed zurückreicht,
  Anzahl Ereignisse, Gültigkeit der Anmeldung
- **Kalibrierung** (siehe 4)
- **Teamwert-Verlauf** als Liniendiagramm (siehe 7.9)
- **Frag die Liga** (siehe 7.10)

### 7.4 MW-Trend — Marktwertbewegung statt Teamwertdifferenz

Die Frage dahinter: *Steigen oder fallen meine Leute gerade?*

Kickbase passt die Marktwerte **täglich um 22:04 Uhr** an.

Gerechnet wird **je Spieler**: sein Marktwert am jüngsten Marktwert-Tag minus
sein Marktwert am Tag davor, aufsummiert über den aktuellen Kader.

> **Nicht zwei gespeicherte Teamwerte vergleichen.** Dann zählen Käufe und
> Verkäufe voll mit: Wer für 20 Mio kauft, steht mit +20 Mio da, ohne dass sich
> ein Marktwert bewegt hätte. Genau das machte die Spalte wertlos.

**Der Marktwert-Tag beginnt um 22:04, nicht um Mitternacht.** Ein um 10:00
abgelesener Marktwert stammt aus der Anpassung des Vorabends und gehört zum Tag
davor. Ohne diese Verschiebung lägen die Ablesungen eines Tages auf zwei Seiten
der Grenze und die Differenz wäre mal 0 und mal die doppelte Bewegung.

**Die Werte kommen aus eigener Mitschrift.** Der gespeicherte Kader wird bei
jedem Laden überschrieben und trägt keine Historie. Deshalb muss bei jedem
Kaderabruf zusätzlich je Spieler und Marktwert-Tag der Marktwert festgehalten
werden. Gezählt wird nur, wer an **beiden** Tagen einen Wert hat — nach der
ersten Aktualisierung steht der Trend deshalb auf „–".

In der Detailzeile stehen zusätzlich **wie viele Spieler gestiegen und wie
viele gefallen** sind: Eine Summe nahe null kann Stillstand bedeuten oder ein
Aufheben von Gewinnen und Verlusten.

### 7.5 Managerseite

Erreichbar über den Namen in der Tabelle. Enthält:

**Kennzahlen** — Gesamtwert, Kontostand, Teamwert, MW-Trend, Kadergröße,
Limit, Max-Gebot, Punkte.

**Kaderprofil** — was der Manager hat und was ihm fehlt:
- **Topspieler**: alle über **25 Mio** Marktwert, mit Anzahl und Namen
- **Bedarf je Position** (Tor, Abwehr, Mittelfeld, Sturm): Hat der Manager dort
  keinen Spieler über **10 Mio**, wird das Feld markiert. Gezeigt wird jeweils
  der teuerste Spieler der Position, damit man den Abstand zur Schwelle sieht.
- Spieler ohne erkennbare Position werden separat gezählt, nicht in den Bedarf
  eingerechnet.

**Die Kontorechnung Posten für Posten** — Startbudget, Login-Bonus,
Punkte-Bonus, Verkäufe, Käufe, Strafen, Korrektur, Ergebnis.

**Der Kader** als sortierbare Tabelle: Position, Name, Marktwert, Kaufpreis,
Gewinn, Punkte.
- **Vorsortiert nach Position: Tor → Abwehr → Mittelfeld → Sturm.**
  Alphabetisch käme ABW, ANG, MF, TW heraus — für einen Kader unbrauchbar.
- **Die Positionsspalte kippt nicht.** Jede andere Spalte dreht beim zweiten
  Klick die Richtung um; die Position kennt nur eine sinnvolle Reihenfolge.
  Umgedreht finge die Liste beim Sturm an.
- Innerhalb einer Position steht der teurere Spieler oben.

**Verkaufsrechner** — Spieler anklicken heißt „verkaufen". Sofort sichtbar:
Erlös, Kontostand danach, Max-Gebot danach, Teamwert danach, Gesamtwert danach.
Ein Knopf **„so wenig wie möglich"** schlägt die kleinste Auswahl vor, die das
Konto ins Plus bringt (teuerste zuerst, damit möglichst wenige Spieler gehen).

**Wahrscheinliche Aufstellung** — vorbelegt mit der **echten Aufstellung aus
Kickbase**. Dafür gibt es einen eigenen Endpunkt, der die Startelf mit ihrer
Position liefert; für wen er antwortet, muss man nicht wissen — die
zurückgegebenen Spieler werden dem Manager zugeordnet, in dessen Kader sie
stehen. Schweigt er, wird im Kader nach einem Feld gesucht, das genau elf
Spieler auszeichnet (als Reihenfolge 1–11, als Wahrheitswert oder als
Status-Code). Trifft nichts zu, bleibt die Auswahl leer und die Seite sagt das.

Elf Spieler wählen, die positionsgetreu auf einem Platz erscheinen: **Sturm oben, Tor unten**, so wie man eine Aufstellung
liest. Dazu System (z. B. `4-3-3`), Gesamtmarktwert und Punktsumme. Ein
Vorschlag sichert die Mindestbesetzung je Position (1 Tor, 3 Abwehr,
2 Mittelfeld, 1 Sturm) und füllt nach Marktwert auf. Die Auswahl gilt für den
Besuch und wird nicht gespeichert.

**Alle Transfers** des Managers mit Datum, Spieler, Preis und Quelle (aus dem
Feed oder rekonstruiert).

**Ein Knopf zur Korrektur** führt direkt in die Einstellungen.

### 7.6 Freie Spieler

Beantwortet zwei Fragen: *Welche Spieler gehören niemandem?* und *Könnte die
Liga sie überhaupt bezahlen?*

- **Frei** = im Bundesliga-Pool, aber in keinem gespeicherten Kader. Ohne
  geladene Kader gilt jeder Spieler als frei — die Seite muss das dann
  deutlich sagen, statt einen leeren Markt vorzutäuschen.
- **Marktwert-Filter**: alle / ab 500 Tsd / 1 / 3 / 5 / 10 / 15 / 20 Mio.
- **Positionsfilter**: Alle / TW / ABW / MF / ANG, jeweils mit Anzahl. Er
  filtert **nur die Liste**, nicht das Verhältnis darunter: „Was kann die Liga
  bezahlen" ist eine Frage über den ganzen freien Markt, nicht über die
  Stürmer darin. Eine Position ohne freie Spieler ist ausgegraut, nicht weg.
- **Verhältnis** = Summe aller Kontostände ÷ Marktwert der freien Spieler im
  gewählten Bereich. Der Filter ist dabei das eigentliche Werkzeug: ohne ihn
  zählen hunderte Ergänzungsspieler mit, die nie jemand kauft.
- Liste sortier- und durchsuchbar, je Spieler mit Rückkehrprognose (7.7).
- **Kaufrechner** oben (7.8).

### 7.6b Startelf-Chance — das Zeichen vor jedem Namen

Auf **allen** Seiten, auf denen Spieler vorkommen (Kader, freie Spieler,
Transfermarkt, News, Live, Aufstellungswahl), steht hinter dem Namen ein
Zeichen: wie sicher der Spieler am kommenden Spieltag in der Startelf steht.
Kickbase liefert das im Spielerprofil als Zahl (`prob`), die Einschätzung
selbst kommt von Ligainsider.

| Zeichen | Wert | Bedeutung |
|---|---|---|
| ★ | 1 | Sicher in der Startelf |
| ✔ | 2 | Sehr wahrscheinlich Stamm |
| ? | 3 | Vielleicht Stamm |
| ! | 4 | Eher nicht, kleine Chance |
| ✕ | 5 | Keine Chance |

Regeln:

- **Kein Zeichen heißt „keine Angabe", nicht „spielt nicht".** Ein geratenes
  Zeichen wäre hier schlimmer als gar keins — danach stellt jemand auf.
- **Die Farbe allein darf die Aussage nicht tragen.** Jede Stufe hat eine
  eigene Form, und der Titel nennt sie im Klartext.
- **Die Angabe kostet einen Abruf je Spieler und veraltet wöchentlich**, weil
  sie den *kommenden* Spieltag beschreibt. Geholt wird in Häppchen, und zwar
  in dieser Reihenfolge: erst wer in einem Kader steht oder am Markt liegt,
  dann der Rest. So steht das Zeichen dort, wo man es braucht, schon nach dem
  ersten Aktualisieren.
- **„Gefragt und nichts bekommen" wird gespeichert**, sonst kostet derselbe
  Spieler bei jedem Lauf erneut einen Abruf.

### 7.7 Wann kommt ein Spieler wieder auf den Markt?

Spieler kehren nach einem festen Rhythmus zurück, anfangs etwa alle 14 Tage.
Der Rhythmus verkürzt sich, je leerer der Markt wird.

**Beobachtet wird das Erscheinen, nicht der Kauf.** Das ist der Kern: Ein
Spieler kann auf den Markt kommen, **ungekauft ablaufen** und 14 Tage später
wiederkommen und dann gekauft werden. Zwischen den beiden *Käufen* lägen
28 Tage, der Rhythmus ist aber 14. Wer aus Kaufabständen rechnet, bekommt
systematisch Vielfache.

Drei Quellen fließen in eine Zeitreihe:

| Quelle | Aussage |
|---|---|
| Ereignis „Neu am Markt" | Der Spieler ist erschienen — die beste Quelle |
| Kauf ohne Verkäufer | Kauf von Kickbase, der Spieler war also am Markt |
| Eigene Mitschrift des Live-Markts | Was wir beim Aktualisieren gesehen haben |

Die Mitschrift ist nötig, weil der Live-Markt flüchtig ist: Ein Angebot steht
rund einen Tag, und das Feed-Fenster reicht nur ~670 Einträge zurück. Ein
Angebot wird über seinen **Ablaufzeitpunkt** identifiziert (auf die Minute
gerundet), damit zweimal Aktualisieren dasselbe Angebot nicht zweimal ablegt.

**Nur Angebote von Kickbase zählen.** Das war der Fehler, der die ersten
Prognosen unbrauchbar machte: „Neu am Markt" feuert auch, wenn ein *Mitspieler*
einen Spieler einstellt. Solche Auftritte folgen keinem Rhythmus, sondern der
Laune des Besitzers — genug davon drücken den Median der ganzen Liga nach unten,
und dann steht überall „jederzeit / überfällig", obwohl der echte Rhythmus
14 Tage ist. Ob ein Spieler frei war, sagt der **letzte Transfer davor**: Hatte
er einen Käufer, lag er in einem Kader.

**Beobachtungen werden zu Auftritten gebündelt:** Erscheinen und Kauf desselben
Angebots sind *ein* Auftritt. Alles, was enger als **36 Stunden** beieinander
liegt, gilt als derselbe Auftritt.

**Der Rhythmus wird laufend neu geschätzt** — Median der Abstände, nicht
Mittelwert, damit einzelne Ausreißer nicht durchschlagen. Zwei Korrekturen:

- Nur die **jüngsten Abstände** (21 Tage) zählen, solange es genug davon gibt.
  Der Rhythmus verkürzt sich mit der Zeit.
- **Abstände über dem 1,6-fachen des Medians fliegen raus.** Sie entstehen
  durch Auftritte, die niemand mitbekommen hat — ein doppelter Abstand ist eine
  Datenlücke, kein doppelter Rhythmus.
- Abstände unter **2 Tagen** zählen nicht (Doppelbeobachtung).
- Unter **4 Abständen** wird nicht geschätzt.

**Ein Verkauf setzt die Uhr neu.** Verankert wird am letzten Ereignis, das den
Spieler *frei gemacht* hat: sein letzter Marktauftritt oder sein Verkauf an
Kickbase — je nachdem, was später war.

**Solange nichts gemessen ist, gilt der Startwert 14 Tage**, und die Prognose
wird als *Annahme* gekennzeichnet.

**Nicht prognostiziert wird:** alles vor dem Stichtag, und Spieler, die seit dem
Reset weder am Markt waren noch verkauft wurden — dort steht „kommt demnächst",
kein Datum.

### 7.8 Kaufrechner

Auf beiden Marktseiten. Spieler anklicken, und oben steht sofort, was der Kauf
mit dem eigenen Konto macht.

Beide Richtungen stehen zusammen, weil ein Kauf meist daran hängt, dass vorher
etwas raus muss: Unter dem Rechner lässt sich der **eigene Kader** aufklappen
und Spieler zum Verkauf antippen.

**Zwei Regler, je 0–50 %**, weil beide Richtungen ihre eigene Unsicherheit
haben: Beim Kauf bietet man über den Marktwert, beim Verkauf an Kickbase
bekommt man genau ihn und bei einem Mitspieler womöglich mehr. Der auf der
Aufschlagseite gemessene Liga-Schnitt lässt sich per Klick übernehmen.

Zwei Dinge, die man leicht falsch rechnet:

1. **Käufe und Verkäufe verschieben das erlaubte Minus.** Ein gekaufter Spieler
   zählt zum Teamwert, und beides — Teamwert und Kontostand — steckt in der
   Basis des Limits. Ein Kauf hebt den einen und senkt den anderen.
2. **Maßgeblich ist nicht der Kontostand danach, sondern die Luft bis zur
   Grenze** (Kontostand + Limit). Sie darf nicht negativ werden.

**Kommende Login-Boni werden mitgerechnet.** Bis zum ersten Spiel des
Spieltags fallen noch Gutschriften an — eine je Mitternacht. Der Wochentag des
Anpfiffs ist einstellbar (Freitag als Vorgabe, Samstag, Dienstag). Ist heute
schon Spieltag, kommt nichts mehr dazu: Die Gutschrift von heute Nacht steckt
bereits im Kontostand. Das ist die vorsichtige Lesart — sie verspricht nie
Geld, das noch nicht da ist. Abschaltbar per Häkchen, vorbelegt an.

### 7.9 Transfermarkt (Live-Sicht)

Was gerade angeboten wird, mit Restzeit. Filter: **alle / nur Kickbase / nur
von Mitspielern**, dazu Namenssuche.

Je Angebot: Bild (falls vorhanden), Name, Position, Marktwert, Punkteschnitt,
Punkte, Marktwert-Trend, Anbieter, Restzeit. Auch hier der Kaufrechner.

**Wie viele Angebote eine Angabe tatsächlich haben, steht als „Abdeckung"
unter der Tabelle.** Leere Spalten sind damit sichtbar als fehlende Daten und
nicht als Fehler.

**Fehlt ein Bild, steht dort nichts** — kein Platzhalterkreis. Eine leere
Scheibe vor jedem Namen sagt nichts aus und stiehlt nur Platz.

### 7.10 Teamwert-Verlauf (Diagramm)

Der Teamwert aller Manager über die Zeit als Liniendiagramm.

- **Tagesraster statt Rohdaten.** Gespeichert wird, wenn jemand aktualisiert —
  bei jedem zu einer anderen Uhrzeit. Deshalb ein festes Raster auf 0 Uhr; der
  Wert eines Tages ist der letzte bekannte Stand davor. Ohne Stand bleibt die
  Linie **leer statt null** — null wäre eine Aussage.
- **Zwölf Linien in zwölf Farben sind unlesbar.** Alle Manager liegen
  zurückhaltend grau im Hintergrund, angeklickte bekommen ihre Farbe.
- Die **Farbe hängt fest am Manager, nicht an seinem Rang** — eine Auswahl darf
  die übrigen nicht umfärben. Höchstens acht farbige Linien gleichzeitig.
- **Die Achse beginnt nicht bei null**, sonst lägen alle Linien am oberen Rand
  und die täglichen Bewegungen wären unsichtbar. Das muss auf der Seite stehen.
- Auf dem Handy entfallen die Namen am Linienende (kein Platz), und der
  Tooltip steht unter dem Diagramm statt darüber.
- **Käufe und Verkäufe zählen hier mit hinein** — anders als beim MW-Trend.
  Das muss dabeistehen.

### 7.11 Aufschläge — was über dem Marktwert gezahlt wurde

Eigene Seite, weil sie eigene Filter mitbringt.

**Aufschlag eines Kaufs = Kaufpreis − Marktwert zum Zeitpunkt des Angebots.**
Nicht der Marktwert von heute, sonst verfälscht jede spätere Änderung das
Ergebnis.

Der damalige Marktwert kommt aus drei Quellen, in dieser Reihenfolge:
1. Das Ereignis „Neu am Markt" (trägt den Marktwert mit)
2. Die eigene Mitschrift des Live-Markts
3. Die **Marktwert-Historie des Spielers**

Die dritte ist nötig, weil die ersten beiden nur Käufe abdecken, deren Angebot
noch im Feed-Fenster liegt: Ein Manager mit 11 Spielern erschien sonst mit
7 Käufen.

**Zwei Filter, beide notwendig:**

- **Herkunft**: *vom Markt* (Vorgabe) / *von Mitspielern* / *alle*. Das sind
  zwei verschiedene Dinge: Am Markt bietet man über den Marktwert, um den
  Zuschlag zu bekommen; bei einem Mitspieler wird verhandelt. In einen Topf
  geworfen ergibt der Durchschnitt keine Aussage — ein einziger solcher Deal
  hob den Schnitt eines Managers von 15 % auf 43 %.
- **Zeitraum**: seit Reset / 14 / 7 / 3 / 1 Tag.

Je Manager: **„Bewertet: 7 von 11"** — auf wie vielen Käufen der Durchschnitt
beruht und wie viele es insgesamt gab. Ein Manager mit 7 bewerteten von 11 darf
nicht neben einem mit 22 von 22 stehen, als wären die Zahlen vergleichbar.

**Ø relativ gewichtet jeden Kauf gleich**, sonst bestimmte ein einziger teurer
Spieler die Quote der ganzen Liga.

### 7.12 Spieler-News

Meldungen der letzten **7 Tage** zu den Spielern im eigenen Kader und zu allen
Angeboten am Transfermarkt, kurz zusammengefasst unter dem jeweiligen Namen.

**Die News werden recherchiert, nicht geliefert.** Kickbase hat keine
Nachrichten. Geholt wird über die **Websuche eines Sprachmodells**: Es sucht
selbst und fasst zusammen. Damit sind überregionale Quellen (kicker,
ligainsider), Regionalmedien (Deichstube, DerWesten) und Transfer-Journalisten
gleichermaßen erreichbar.

**Die Suche wird nicht auf eine feste Quellenliste eingeengt** — eine solche
Liste schlösse genau die regionalen Quellen aus, die man vorher nicht
aufzählen kann. Stattdessen stehen die bevorzugten Quellen in der Anweisung,
und **jede Meldung nennt ihre Herkunft** samt Link.

**Gesucht wird über Name und Verein, nicht über die interne Spieler-ID.** Das
Internet kennt diese ID nicht; sie im Prompt zu führen stiftet nur Verwirrung.
Zugeordnet wird über eine laufende Nummer aus der Liste. Der **Vereinsname**
muss dabei ein echter Name sein — eine interne Vereins-Nummer („Undav (7)") ist
für eine Nachrichtensuche schlimmer als gar keine Angabe.

**Zwei Modi, weil Recherche Geld kostet:**

- **Sammeln** (Normalfall): Ein Aufruf deckt **zwölf Spieler** ab, und gesucht
  wird auf **Übersichtsseiten** — die Ausfall- und Sperrenlisten der großen
  Portale führen hunderte Spieler auf einmal. Drei bis fünf Suchen beantworten
  damit die Frage für ein ganzes Bündel. Aus 71 Einzelrecherchen werden sechs
  Anfragen.
- **Einzeln**: die Tiefensuche mit mehr Suchen und breiteren Quellen — nur auf
  ausdrücklichen Klick („genauer") und immer für genau einen Spieler.

Welcher Modus gilt, muss der **Server** entscheiden, nicht der Browser — sonst
kann ein manipulierter Aufruf einen teureren Lauf auslösen.

**Weitere Regeln:**

- Recherchiert wird bündelweise mit Fortschrittsanzeige. Was fertig ist, ist
  gespeichert; ein Abbruch kostet nur das laufende Bündel.
- **Ein einzelner Ausfall darf den Lauf nicht mitreißen.** Der betroffene
  Spieler wird vermerkt, es geht weiter. Scheitern die ersten drei Versuche
  ohne einen Erfolg, bricht der Lauf ab, statt weiter Geld auszugeben.
- **„Nichts gefunden" wird gespeichert, eine ausbleibende Antwort nicht.**
  Sonst kostet derselbe Spieler bei jedem Lauf erneut Geld — aber ein einziger
  kaputter Lauf würde alle Spieler als „erledigt" markieren und dauerhaft
  blockieren. Ein Knopf **„N leere verwerfen"** räumt solche Einträge weg.
- „Nichts Neues in den letzten 7 Tagen" und „Noch nicht recherchiert" sind
  **zwei verschiedene Zustände** und werden verschieden angezeigt.
- Was jünger als 12 Stunden ist, wird nicht neu geholt. Ein zweiter Knopf holt
  trotzdem alles neu.
- **Ein stiller Ausfall sieht aus wie ein Ergebnis.** Null Meldungen können
  heißen: nichts gefunden, Antwort nicht zuordenbar, oder die Suche lief gar
  nicht. Jeder Aufruf muss deshalb zurückgeben, **wie viele Suchen liefen, wie
  viele Einträge kamen und wie viele verworfen wurden** — und die Seite muss
  diese Zahlen zeigen, wenn ein Lauf ohne Meldung bleibt.
- **Die Anweisung darf das Ergebnis nicht vorwegnehmen.** Stand darin, zu den
  meisten Spielern sei ohnehin nichts zu finden, ist „nichts" die bequemste
  Antwort. Stattdessen: eine Mindestzahl an Suchen verlangen und für *jeden*
  Spieler einen Eintrag.
- **Erfinden ist schlimmer als nichts.** Eine erfundene Verletzungsmeldung ist
  hier deutlich schädlicher als eine leere Zeile — danach würde jemand
  verkaufen.

### 7.13 Frag die Liga

Freie Fragen zum Datensatz („Wen muss X verkaufen, um aus dem Minus zu
kommen?", „Kann ich mir Spieler Y leisten?").

- **Jeder zahlt selbst.** Der Server hat keinen eigenen Zugang zum Sprachmodell;
  jeder Nutzer hinterlegt seinen eigenen Schlüssel, der im Browser bleibt und
  bei jeder Frage mitgeschickt, einmal benutzt und nicht gespeichert wird.
- Drei Anbieter stehen zur Wahl.
- **Modellnamen werden beim Anbieter erfragt, nicht fest verdrahtet** — eine
  feste Liste wäre in wenigen Monaten falsch.
- Der Datensatz wird als **Text** übergeben, nicht als Struktur: kompakter, und
  das Modell muss nichts entpacken. Enthalten sind alle Manager mit ihren
  Kennzahlen, die Kader und die 80 wertvollsten freien Spieler — der lange
  Schwanz billiger Ergänzungsspieler bringt für Fragen nichts.
- Der Datensatz steht in einem zwischenspeicherbaren Block, die wechselnde
  Frage getrennt davon — sonst wäre der Zwischenspeicher bei jeder Frage
  hinfällig.
- **Namen sind Daten, keine Anweisungen.** Manager- und Spielernamen stammen
  von Nutzern; sie stehen zwischen klaren Markierungen, und die Anweisung sagt
  ausdrücklich, dass Text, der wie eine Anweisung aussieht, als Name zu
  behandeln ist.

### 7.14 Einstellungen

Je Nutzer, nicht je Liga (siehe 9):

- **Startbudget** und **Stichtag** der Liga
- **Punkte-Bonus** je Punkt (1.000 €)
- **Login-Bonus an/aus** und ab wann gezählt wird
- **Erstes Spiel des Spieltags**: Freitag (Vorgabe) / Samstag / Dienstag
- **Manuelle Korrektur je Manager**, mit Begründung — hier trägt man Strafen
  aus der Datenlücke ein
- Freitextnotiz

**Startbudget und Stichtag dürfen niemals automatisch überschrieben werden.**
Sie werden nur vorbelegt, wenn sie leer sind. Eine frühere Version überschrieb
sie bei jedem Aufruf mit Werten aus der Kickbase-Übersicht und verwarf damit
stillschweigend jede manuelle Korrektur.

---

## 8. Aktualisieren

**Es gibt genau einen Knopf.** Er macht nacheinander: Feed importieren,
Transfermarkt mitschreiben, Spielerliste pflegen, Teamwerte, Marktwert-
Historien, Kader, Rekonstruktion. Danach kommt man dorthin zurück, wo man
geklickt hat.

**Die Aktualisierung ist ausdrücklich manuell** — kein automatischer Lauf im
Hintergrund.

### Nur holen, was sich geändert hat

Kein Zeitfenster, sondern nachsehen. Ein erster Versuch mit „Teamwerte alle
6 Stunden, Kader alle 12" war falsch: Hatte jemand vor einer Stunde gekauft,
wäre sein Kader bis zu zwölf Stunden veraltet gewesen.

Kader und Teamwert eines Managers ändern sich aus genau zwei Gründen:

| Grund | Wirkung |
|---|---|
| Ein **Transfer** | Ändert Kader und Teamwert — aber nur bei diesem einen Manager. Der Feed sagt, wer es war. |
| Die **tägliche Marktwertanpassung** | Danach sind Teamwert *und* die gespeicherten Marktwerte je Spieler veraltet |

Neu geholt wird also, wenn es keinen Stand gibt, der Stand vor dem letzten
Bezugspunkt liegt (**der spätere von letzter Mitternacht und letzter
Marktwertanpassung um 22:04**), oder seither ein Transfer dieses Managers lief.
Sonst nichts.

In der Praxis: Der erste Klick am Tag holt alles, jeder weitere kostet nur noch
die Manager, die seitdem gehandelt haben. Es fehlt dabei nie etwas.

### Die Spielerliste täglich pflegen

Einmal am Tag werden alle 18 Vereine durchgegangen. **Zusammenführen, nicht
ersetzen:** Neuzugänge kommen dazu, Bekannte werden aktualisiert. Scheitert ein
Vereinsabruf, bleiben dessen Spieler aus dem letzten Stand erhalten.

Der Stand wird **nur fortgeschrieben, wenn wirklich alle Vereine dran waren** —
sonst stünde ein halber Durchlauf als „heute erledigt" da. Solange etwas fehlt,
wird es als offen ausgewiesen, und der nächste Klick macht weiter.

**Gebaut wird nur im Aktualisieren-Lauf, nie beim Seitenaufruf.** Eine frühere
Fassung baute die Liste beim Rendern der Marktseite neu, sobald ihr
Zwischenspeicher alt war — 19 Anfragen mitten im Seitenaufbau, ohne dass jemand
einen Knopf gedrückt hätte.

### Umgang mit Drosselung

Der Anbieter drosselt, und ein zu großer Lauf führte einmal dazu, dass sich der
Nutzer vorübergehend nicht mehr bei Kickbase einloggen konnte. Auslöser: 60 bis
300 Anfragen, mehrfach hintereinander ausgelöst.

**Alle Aufrufe müssen durch eine einzige Stelle laufen** — eine Bremse, ein
Hebel. Sie macht drei Dinge:

1. **Mindestabstand** zwischen zwei Anfragen (600 ms), über alle Lader hinweg
2. Bei Drosselung **warten und wiederholen**, mit wachsendem Abstand und nach
   der Vorgabe des Anbieters, wenn er eine nennt
3. **Bleibt es dabei, gilt der ganze Lauf als gedrosselt** und jeder weitere
   Aufruf bricht sofort ab. Das ist der wichtigste Punkt: Vorher machte jeder
   Lader für sich weiter und verlängerte die Drosselung.

Dazu:
- Marktwert-Historien höchstens 10 Spieler je Lauf
- Der Endpunkt für die Historie wird **einmal mit einem Spieler sondiert**
  statt für jeden Spieler blind durchprobiert
- **Zeitbudget 45 s**, dann kontrollierter Abbruch mit gespeicherter Position;
  der nächste Klick macht dort weiter
- Alle Seitenaufrufe lesen aus der Datenbank, nie live vom Anbieter

Ein Lauf kostet damit rund 20 statt 100+ Anfragen.

---

## 9. Zugriffsschutz

Die Datenbank ist für alle Nutzer dieselbe: Ereignisse, Einstellungen und
Korrekturen hängen an der Liga, nicht am Nutzer. Ohne Prüfung könnte jeder
Angemeldete mit einer fremden Liga-ID in der Adresse deren Einstellungen
überschreiben oder gespeicherte Transfers lesen.

**Regeln:**

- **Jede Seite und jede Schnittstelle, die eine Liga-ID aus der Adresse nimmt,
  prüft sie** gegen die Ligen des angemeldeten Nutzers.
- **Formularaktionen prüfen selbst.** Die Liga-ID kommt aus dem Formular und
  ist manipulierbar — die Prüfung in der Seite schützt die Aktion nicht.
- **Alles, was schreibt, läuft über POST**, zusätzlich mit Herkunftsprüfung.
  Ein GET, das Daten ändert, lässt sich von einer fremden Seite auslösen.
- Mehrfache Prüfungen in einem Seitenaufbau dürfen nur **einen** Abruf kosten.

**Was das nicht leistet:** Mitglieder derselben Liga teilen sich den Datensatz.
Wer in der Liga ist, kann Einstellungen für alle ändern — das ist so gewollt.

**Persönliche Einstellungen:** Jeder Nutzer hat seinen eigenen Satz Grundwerte
und Korrekturen; beim ersten Aufruf werden sie aus dem Ligastand übernommen.
Sonst würde eine Änderung die Zahlen aller Mitspieler verändern.

---

## 9a. Herkunft: Region und Sprache

Kickbase stuft einen Zugang nach Herkunft ein. Kommen die Aufrufe aus einer
fremden Region oder ohne deutsche Spracheinstellung, kann der Account auf
„international" umspringen — dann fehlen Inhalte, die es nur in der
Bundesliga-Sicht gibt.

Deshalb: **`Accept-Language: de-DE` an jedem Aufruf** und Betrieb in einer
**deutschen Region**. Beides kostet nichts und verhindert ein Problem, das man
sonst nie als Ursache erkennen würde.

**Rechtlicher Rahmen:** Kickbase untersagt in seinen Bedingungen die
gewerbliche Nutzung und das automatisierte Auslesen von Daten ohne Zustimmung.
Das gehört sichtbar dorthin, wo sich jemand verbindet.

---

## 10. Zeitzone

**Alles wird in deutscher Zeit angezeigt und eingegeben**, unabhängig davon, wo
der Server steht. Ohne diese Festlegung nimmt die Formatierung die Zone der
Laufzeitumgebung — auf einem Server in UTC also im Sommer zwei Stunden neben
der Uhr des Nutzers.

Fest auf deutsche Zeit statt auf die des Browsers, weil die Liga eine deutsche
ist: Marktschluss und Reset nennt Kickbase in deutscher Zeit. Ein fester Wert
sorgt außerdem dafür, dass Server und Browser dieselbe Zeichenkette erzeugen.

**Der Stichtag ist der kritische Punkt.** Er kam aus dem Formular ohne Zone in
ein Zeitstempel-Feld und wurde als UTC gelesen — der gespeicherte Zeitpunkt lag
zwei Stunden hinter dem, was der Nutzer eingetippt hatte. Da die Kontorechnung
danach filtert, konnten Transfers rund um den Reset falsch ein- oder
ausgeschlossen werden. Eingabe und Ausgabe müssen beide als deutsche Ortszeit
behandelt werden.

---

## 11. Welche Daten gespeichert werden müssen

Ohne Technik, nur die Inhalte:

| Was | Inhalt |
|---|---|
| **Ereignisse** | Alle Feed-Einträge einer Liga: Typ, Zeitpunkt, Käufer, Verkäufer, Preis, Spieler. Rekonstruierte sind als solche erkennbar |
| **Einstellungen** | Je Nutzer und Liga: Stichtag, Startbudget, Punkte-Bonus, Login-Einstellungen, Spieltagsbeginn, Notiz |
| **Korrekturen** | Je Nutzer, Liga und Manager: Betrag und Begründung |
| **Importstand** | Wann zuletzt importiert wurde, wie weit, ob vollständig |
| **Spielerliste** | Alle Bundesligaspieler mit Name, Verein, Position, Marktwert — plus Stand |
| **Teamwerte** | Je Manager: Teamwert, Kadergröße, Stand |
| **Tagesstand** | Je Manager und Kalendertag: Teamwert, Kontostand, Punkte — Grundlage der Platzierungspfeile |
| **Teamwert-Verlauf** | Je Manager ein Eintrag je Änderung — **nur bei echter Änderung fortschreiben**, sonst setzt zweimaliges Aktualisieren den Trend auf null |
| **Kader** | Je Manager und Spieler: Name, Position, Marktwert, Kaufpreis, Punkte |
| **Marktwert-Ablesungen** | Je Spieler und Marktwert-Tag ein Wert (eigene Mitschrift, Grundlage des MW-Trends) |
| **Marktwert-Historie** | Je Spieler und Kalendertag (vom Anbieter geholt, Grundlage der Aufschläge) |
| **Marktbeobachtungen** | Je Liga, Spieler und Angebotsablauf: wann gesehen, welcher Marktwert |
| **News** | Je Liga und Spieler: Text, Stimmung, Quellen, Stand. Leerer Text = nachgesehen, nichts gefunden |

> **Marktwert-Ablesungen und Marktwert-Historie bewusst getrennt halten.** Die
> einen sind Marktwert-Tage aus eigener Ablesung (Grenze 22:04), die anderen
> Kalendertage aus fremder Historie. In einer Tabelle vermischt lägen sie um
> bis zu einen Tag versetzt.

---

## 12. Bekannte Eigenheiten und Fallstricke

**Manager werden über Anzeigenamen identifiziert, nicht über IDs.** Der Feed
liefert nur den Namen. Bei einer Namensänderung bricht die Zuordnung, doppelte
Namen müssen in der Oberfläche markiert werden.

**Der Liga-Admin wird gefiltert**, weil er in der Beispielliga nicht mitspielt.
In anderen Ligen kann der Admin durchaus Manager sein — das sollte eine
Einstellung werden.

**Selbstzuordnung:** Wer der angemeldete Nutzer in der Liga ist, wird zuerst
über die Nutzer-ID versucht, dann über den Anzeigenamen. Schlägt beides fehl,
wählt der Nutzer sich einmalig aus einer Liste — das ist der zuverlässige
Rückfall.

**Der Punkte-Bonus beträgt 1.000 € je Punkt.** Lange stand hier 10.000 € — eine
Annahme aus der Zeit, als die Punktzahl überall 0 war und sich nichts prüfen
ließ. Ein Faktor 10 auf einen Posten, der mit den Saisonpunkten wächst.

**Kadergröße = Käufe − Verkäufe.** Das von Kickbase gelieferte Feld ist etwas
anderes (vermutlich die Zahl aller Transfers) und liefert unplausible Werte.

**Spielernamen kommen nicht aus dem Kader-Abruf.** Der liefert Position,
Marktwert und Kaufpreis, aber unter keinem erkennbaren Feld einen Namen. Namen
müssen über die Spieler-ID aus zwei anderen Quellen aufgelöst werden: der
Bundesligaliste und den gespeicherten Ereignissen (dort führt jeder Transfer
den Namen mit). Die Ereignisse gewinnen, weil sie den Namen so schreiben, wie
die Liga ihn sieht.

**Bei unbekannten Feldnamen wird gesucht, nicht geraten.** An mehreren Stellen
ist nicht dokumentiert, unter welchem Feld eine Angabe steht (Bilder,
Spielerliste im Kader, Marktwert-Historie, Vereinsname). Die Lösung ist immer
dieselbe: bekannte Kandidaten durchprobieren, das Ergebnis auf Plausibilität
prüfen und im Zweifel **nichts** zurückgeben statt etwas Falsches.

**Keine Heuristik ohne Plausibilitätsgrenze.** Jede Ableitung („das sieht aus
wie X Tage Bonus") braucht eine Prüfung, ob das Ergebnis überhaupt in die
Laufzeit der Liga passt.

**Keine Hochrechnungen für fehlende Strafen.** Das war einmal drin und wurde
bewusst entfernt — es suggeriert Präzision, die nicht existiert.

---

## 13. Gestaltung

- **Erklärungen und Warnungen sind Popups**, keine dauerhaften Kästen. Große
  Hinweisblöcke verdrängen die Zahlen, um die es geht. Gezeigt wird ein
  einzeiliger Anreißer; der ganze Text kommt auf Klick.
- **Kurze Rückmeldungen auf eine Aktion** („12 neue Ereignisse importiert")
  bleiben einzeilig im Fluss und stehen direkt unter dem Knopf, der sie
  ausgelöst hat.
- **Alle Farben, Abstände und Radien zentral definieren**, nicht in einzelne
  Bausteine schreiben. Solange das Layout in Style-Objekten steckte, war
  Mobilunterstützung technisch unmöglich.
- Breakpoints: 900 px (Kopfzeile stapelt), 640 px (Handy hochkant), 360 px.
- Geprüft bei 320/360/390/430/640/768/900/1280 px: **kein horizontales Scrollen
  der Seite**. Ab 390 px passt auch die Tabelle ohne Scrollen; zwischen 768 und
  900 px scrollt sie innerhalb ihres Rahmens, die Namensspalte bleibt stehen.
- Beträge auf schmalen Displays in Kurzform („53,7 Mio" statt „53.700.000 €").

---

## 14. Was noch offen ist

1. **Punkte-Bonus nach dem ersten Spieltag verifizieren**
2. **Dunkelmodus** — bewusst noch nicht umgesetzt: Eine frühere Regel färbte
   nur den Seitenhintergrund um, während Karten und Tabelle weiß blieben. Ein
   echter Dunkelmodus braucht alle Farben als Token.
3. **Admin-Filter zur Einstellung machen**
4. **Bietrechner**: wer kann bei welchem Spieler mitbieten — alle Zahlen dafür
   liegen bereit
5. **Punkte der letzten fünf Spiele** am Transfermarkt — dafür liefert der
   Markt-Abruf nichts, es bräuchte einen zweiten Abruf je Spieler

---

## 15. Drei Regeln, die sich bewährt haben

**Bei Unsicherheit über eine Schnittstelle oder ein Datenformat: erst eine
Diagnoseseite bauen, die mehrere Kandidaten durchprobiert, dann implementieren.**
So sind alle bisherigen Erkenntnisse entstanden. Raten hat in diesem Projekt
mehrfach zu Fehlern geführt, die erst durch die Kalibrierung auffielen — oder
gar nicht, weil sie nur Gegner betrafen.

**Fehler an ihrer Ursache unterscheiden, nicht am Wortlaut.** Ein Abgleich auf
den Meldungstext hat hier schon zweimal die falschen Fehler eingefangen. Der
Statuscode gehört ans Fehlerobjekt.

**Jede Seite gegen echte Daten rendern, bevor sie ausgeliefert wird.** Ein
erfolgreicher Übersetzungslauf sagt nur, ob der Code übersetzt — nicht, ob die
Seite läuft. Drei Ausfälle in Folge kamen genau daher; ein falscher Spaltenname
in einer Abfrage ist für keinen Übersetzer und keinen Linter sichtbar.
