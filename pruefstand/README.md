# Prüfstand

Rendert **jede Seite mit echten Daten**, bevor etwas ausgeliefert wird.

## Warum

Der Build sagt nur, ob der Code übersetzt. Er sagt nicht, ob die Seite läuft.
Drei Ausfälle in Folge kamen genau daher und fielen erst beim Nutzer auf:

| Fehler | Build | Linter | Prüfstand |
|---|---|---|---|
| Benutzte Funktion nicht importiert | grün | ✗ (seit `no-undef`) | ✗ |
| Variable vor ihrer Definition gelesen | grün | ✗ (seit `no-use-before-define`) | ✗ |
| Falscher Spaltenname in SQL | grün | grün | **✗** |

Die dritte Zeile ist der Grund für den Aufwand: Kein Linter der Welt kennt
das Datenbankschema.

## Was dabei läuft

- **Echtes Postgres** auf Port 5433 statt Neon. `lib/db.js` schaltet den
  Treiber um, wenn `DATABASE_URL` auf localhost zeigt.
- **Kickbase abgeklemmt.** `kickbase-attrappe.cjs` wird über
  `NODE_OPTIONS=--require` geladen und fängt jeden Aufruf an
  `api.kickbase.com` ab. Der Produktionscode bleibt unangetastet und merkt
  nichts davon. **Es geht kein einziger echter Aufruf raus.**
- **Daten mit Ecken.** `saat.sql` enthält bewusst die Fälle, die schon mal
  Fehler ausgelöst haben: Datenlücke, Käufe mit und ohne auffindbaren
  Marktwert, ein Spieler ohne Namen, ein Deal zwischen zwei Managern, ein
  Verkauf an Kickbase, ein Spieler mit zwei Marktauftritten.

## Benutzen

```bash
export DATABASE_URL="postgres://postgres@localhost:5433/postgres"
export NODE_OPTIONS="--require $(pwd)/pruefstand/kickbase-attrappe.cjs"
npx next dev -p 3300 &

# einmal aufrufen, damit initSchema das Schema anlegt, dann säen
curl -s -o /dev/null "http://localhost:3300/liga?league=1"
psql -h /tmp -p 5433 -U postgres -f pruefstand/saat.sql

node pruefstand/seiten.js 3300
```

Ausgabe ist eine Zeile je Seite mit HTTP-Status, Konsolenfehlern und
horizontalem Überlauf. Rückgabewert ist 1, sobald eine Seite kaputt ist.

## KB_MW

Mit `KB_MW=1` liefert die Attrappe unter genau einem Pfad eine
Marktwert-Historie. So lassen sich beide Wege prüfen: die Suche, die fündig
wird, und die, die aufgibt.

## KB_NEUZUGANG und KB_TEAMFEHLER

`KB_NEUZUGANG=1` legt einen Spieler in einen Vereinskader und ändert den
Marktwert eines anderen. Damit lässt sich prüfen, dass der Pool wirklich
**zusammenführt** und Neuzugänge meldet — und nicht bloß fehlerfrei
durchläuft.

`KB_TEAMFEHLER=1` lässt einen Verein mit HTTP 500 antworten. Seine Spieler
müssen danach **noch im Pool stehen** und der Stand darf **nicht**
fortgeschrieben sein, sonst fiele der Verein bis zum nächsten Tag aus.

```bash
# nächster Tag simulieren
psql -h /tmp -p 5433 -U postgres -c \
  "UPDATE pool_cache SET daten = jsonb_set(daten,'{stand}',
   to_jsonb((now() - interval '1 day')::text)) WHERE id='bundesliga_v2';"
```

## KB_401 und KB_TOKEN_TAGE

`KB_401=1` lässt Kickbase auf alles mit 401 antworten — wie bei einem
abgelaufenen Token. Alle Einstiege müssen dann nach
`/login?abgelaufen=1` führen. Damit wurde nachgemessen, dass `/liga`
vorher mit **HTTP 500** antwortete.

`KB_TOKEN_TAGE` (Vorgabe 30) steuert, wie lange das JWT gilt, das die
Attrappe beim Login ausgibt. So lässt sich prüfen, dass die
Cookie-Laufzeit wirklich aus dem Token gelesen und nicht geraten wird.

## KB_ELF

`KB_ELF=1` füllt die Kader der Attrappe auf 18 Spieler auf und trägt ein Feld
`lineup_order` mit 1..18 ein — die vermutete Kodierung von Kickbase (1–11
Startelf, danach die Bank). Erst ab zwölf Spielern greift die Felderkennung
überhaupt; mit weniger gilt der Kader ohnehin komplett als aufgestellt.

## KB_LEER

`KB_LEER=1` lässt einen Manager eine unauswertbare Kaderantwort liefern.
Der Lauf muss ihn dann **namentlich** nennen („ohne auswertbare Liste:
PetzS"), nicht nur zählen — sonst weiß man nicht, wo man nachsehen soll.

## Was er nicht leistet

Er prüft, ob Seiten **rendern** — nicht, ob die Zahlen stimmen. Dafür sind
die einzelnen Durchrechnungen da (Rhythmus, Aufschlag, Verlauf), die ohne
Datenbank auskommen.
