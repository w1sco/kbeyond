// Die Bausteine des zurückgerechneten Verlaufs.
import { tageZwischen, wertAmTag } from "../lib/verlauf.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};

// ── Tage zwischen zwei Zeitpunkten ─────────────────────────────────
pruefe("drei Tage", tageZwischen("2026-08-01T00:48:00Z", "2026-08-03T10:00:00Z"),
  ["2026-08-01", "2026-08-02", "2026-08-03"]);
pruefe("ein Tag", tageZwischen("2026-08-01", "2026-08-01"), ["2026-08-01"]);
pruefe("Ende vor Anfang", tageZwischen("2026-08-05", "2026-08-01"), []);
pruefe("Monatswechsel", tageZwischen("2026-07-31", "2026-08-02"),
  ["2026-07-31", "2026-08-01", "2026-08-02"]);
pruefe("ohne Anfang", tageZwischen(null, "2026-08-02"), []);

// Ein unsinniger Stichtag darf nicht Hunderttausende Tage erzeugen.
pruefe("gedeckelt", tageZwischen("1990-01-01", "2026-08-30").length, 400);

// Zeitumstellung: Der Tag darf nicht verschluckt oder verdoppelt werden.
pruefe("Sommerzeit beginnt", tageZwischen("2026-03-28", "2026-03-30"),
  ["2026-03-28", "2026-03-29", "2026-03-30"]);
pruefe("Winterzeit beginnt", tageZwischen("2026-10-24", "2026-10-26"),
  ["2026-10-24", "2026-10-25", "2026-10-26"]);

// ── Marktwert an einem Tag ─────────────────────────────────────────
const reihe = [["2026-08-01", 100], ["2026-08-05", 120], ["2026-08-09", 90]];
pruefe("genau am Tag", wertAmTag(reihe, "2026-08-05"), 120);
pruefe("letzter davor", wertAmTag(reihe, "2026-08-07"), 120);
pruefe("nach dem letzten", wertAmTag(reihe, "2026-09-01"), 90);
pruefe("vor dem ersten", wertAmTag(reihe, "2026-07-31"), null);
pruefe("leere Reihe", wertAmTag([], "2026-08-05"), null);
pruefe("keine Reihe", wertAmTag(undefined, "2026-08-05"), null);

// Ein Wert von 0 ist ein Wert, keine Lücke.
pruefe("null ist ein Wert", wertAmTag([["2026-08-01", 0]], "2026-08-02"), 0);

console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
