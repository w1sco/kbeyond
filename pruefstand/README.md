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

## Was er nicht leistet

Er prüft, ob Seiten **rendern** — nicht, ob die Zahlen stimmen. Dafür sind
die einzelnen Durchrechnungen da (Rhythmus, Aufschlag, Verlauf), die ohne
Datenbank auskommen.
