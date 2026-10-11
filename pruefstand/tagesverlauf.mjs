// Die Bausteine des zurückgerechneten Verlaufs.
import { tageZwischen, wertAmTag, punkteAmTag } from "../lib/verlauf.js";

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

// ── Punkte an einem vergangenen Tag ────────────────────────────────
//
// Gemessen am 01.10. (100) und 08.10. (300); angepfiffen am 20.09., 03.10.
// und 04.10. Punkte bewegen sich nur, wenn gespielt wird.
{
  const g = [["2026-10-01", 100], ["2026-10-08", 300]];
  const a = ["2026-09-20", "2026-10-03", "2026-10-04"];
  pruefe("Punkte: gemessener Tag", punkteAmTag("2026-10-01", g, a), 100);
  pruefe("Punkte: kein Spiel seit der Messung davor", punkteAmTag("2026-10-02", g, a), 100);
  pruefe("Punkte: Spieltag mitten in der Lücke — unbekannt", punkteAmTag("2026-10-03", g, a), null);
  pruefe("Punkte: nach dem letzten Spiel gilt die Messung danach", punkteAmTag("2026-10-04", g, a), 300);
  pruefe("Punkte: kein Spiel bis zur Messung danach", punkteAmTag("2026-10-06", g, a), 300);
  pruefe("Punkte: vor dem ersten Anpfiff ist es 0", punkteAmTag("2026-09-10", g, a), 0);
  pruefe("Punkte: vor der ersten Messung, ohne Spiel dazwischen", punkteAmTag("2026-09-25", g, a), 100);
  pruefe("Punkte: Anpfiff am Messtag selbst zählt als Bewegung",
    punkteAmTag("2026-10-05", [["2026-10-04", 250]], ["2026-10-04"]), null);
  pruefe("Punkte: nach der letzten Messung, ohne Spiel seither",
    punkteAmTag("2026-10-10", g, a), 300);
  pruefe("Punkte: nichts gemessen, schon gespielt — unbekannt",
    punkteAmTag("2026-10-02", [], a), null);
  pruefe("Punkte: leere Messung wird übersprungen",
    punkteAmTag("2026-10-02", [["2026-10-01", null]], a), null);
}

console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
