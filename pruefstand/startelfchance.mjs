// Die Startelf-Chance: liest sie das Richtige, und schweigt sie im Zweifel?
import { STUFEN, stufe, leseChance, chanceRang, verteilung } from "../lib/startelf.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a === b) { ok++; }
  else { fehler++; console.log(`✗ ${name}\n    ist:  ${a}\n    soll: ${b}`); }
};

// ── Die fünf Stufen ────────────────────────────────────────────────
pruefe("fünf Stufen", STUFEN.length, 5);
pruefe("Werte 1..5", STUFEN.map((s) => s.wert), [1, 2, 3, 4, 5]);
pruefe("jede Stufe hat ein eigenes Zeichen",
  new Set(STUFEN.map((s) => s.zeichen)).size, 5);
pruefe("jede Stufe hat eine eigene Klasse",
  new Set(STUFEN.map((s) => s.klasse)).size, 5);
for (const s of STUFEN) {
  pruefe(`Stufe ${s.wert} findet sich wieder`, stufe(s.wert).zeichen, s.zeichen);
}

// ── Was keine Stufe ist ────────────────────────────────────────────
for (const w of [0, 6, -1, 2.5, null, undefined, "", "zwei", NaN, Infinity]) {
  pruefe(`kein Wert: ${String(w)}`, stufe(w), null);
}
// Eine Zeichenkette wird umgewandelt – die Datenbank liefert INT, eine
// rohe Antwort auch mal "2". Beide Wege enden bei derselben Stufe.
pruefe('Zeichenkette "2" ergibt Stufe 2', stufe("2").wert, 2);
pruefe("leere Zeichenkette ergibt nichts", stufe(""), null);
pruefe("Leerzeichen ergeben nichts", stufe("  "), null);

// ── leseChance: nur `prob`, nichts anderes ─────────────────────────
pruefe("prob wird gelesen", leseChance({ prob: 2 }), 2);
pruefe("prob 1 (sicher)", leseChance({ prob: 1 }), 1);
pruefe("prob 5 (spielt nicht)", leseChance({ prob: 5 }), 5);
pruefe("prob als Zeichenkette", leseChance({ prob: "3" }), 3);

// Der eigentliche Punkt: Im selben Objekt stehen lauter kleine Zahlen, die
// zufällig passen würden. Keine davon darf zur Startelf-Angabe werden.
const echtesProfil = { i: "173", pos: 2, mvt: 2, st: 0, day: 1, shn: 4, r: 0, y: 0 };
pruefe("kein prob → nichts", leseChance(echtesProfil), null);
pruefe("pos wird nicht als Chance gelesen", leseChance({ pos: 3 }), null);
pruefe("mvt wird nicht als Chance gelesen", leseChance({ mvt: 2 }), null);
pruefe("st wird nicht als Chance gelesen", leseChance({ st: 1 }), null);

pruefe("prob 0 ist keine Stufe", leseChance({ prob: 0 }), null);
pruefe("prob 6 ist keine Stufe", leseChance({ prob: 6 }), null);
pruefe("prob null", leseChance({ prob: null }), null);
pruefe("kein Objekt", leseChance(null), null);
pruefe("Zeichenkette statt Objekt", leseChance("prob"), null);
pruefe("leeres Objekt", leseChance({}), null);

// Das echte Profil von Jonathan Tah, gekürzt — daran ist das Feld belegt.
pruefe("echtes Profil (Tah)",
  leseChance({ i: "173", ln: "Tah", tid: "2", pos: 2, mv: 35344728, mvt: 2,
               plpt: "Ligainsider", prob: 2, ts: "2026-08-31T18:32:03Z" }), 2);

// ── Reihenfolge: sicher zuerst, unbekannt zuletzt ──────────────────
pruefe("Rang folgt der Stufe", [1, 2, 3, 4, 5].map(chanceRang), [1, 2, 3, 4, 5]);
pruefe("Unbekanntes steht hinten", chanceRang(null) > chanceRang(5), true);
pruefe("Unbekannt ist keine Absage — es steht hinter allen Stufen",
  STUFEN.every((s) => chanceRang(s.wert) < chanceRang(undefined)), true);

const gemischt = [3, null, 1, 5, 1, "keine Ahnung"];
pruefe("sortiert nach Sicherheit",
  [...gemischt].sort((a, b) => chanceRang(a) - chanceRang(b)),
  [1, 1, 3, 5, null, "keine Ahnung"]);

// ── Verteilung über einen Kader ────────────────────────────────────
const v = verteilung([1, 2, 2, 5, null, 9]);
pruefe("Verteilung: gesamt", v.gesamt, 6);
pruefe("Verteilung: ohne Angabe", v.ohne, 2);
pruefe("Verteilung: zweimal Stufe 2", v.jeStufe.get(2), 2);
pruefe("Verteilung: keine Stufe 3", v.jeStufe.get(3), 0);
pruefe("Verteilung: leerer Kader", verteilung([]).gesamt, 0);
pruefe("Verteilung: nichts übergeben", verteilung().ohne, 0);
pruefe("Verteilung: Summe geht auf",
  [...verteilung([1, 2, 2, 5, null, 9]).jeStufe.values()].reduce((a, b) => a + b, 0) + v.ohne,
  6);

console.log(fehler ? `\n${ok} ok, ${fehler} Fehler` : `\n${ok} ok, 0 Fehler`);
process.exit(fehler ? 1 : 0);
