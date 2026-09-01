// Spielplan und Punkte je Spiel — an echten Antwortformen geprüft.
import {
  leseSpielplan, aktuelleSaison, leseLeistungen, mannschaftsPunkte,
} from "../lib/spielplan.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};

// ── Der Spielplan ──────────────────────────────────────────────────
// Genau die Form aus `/v4/competitions/1/matchdays`: Spieltag 1 gespielt
// (mit Toren), Spieltag 2 noch nicht (ohne Tore, dafür mit Quoten).
const MATCHDAYS = {
  it: [
    { day: 1, mdln: "Spieltag 1", it: [
      { mi: "11914", day: 1, dt: "2026-08-28T18:30:00Z", t1: "2", t2: "9",
        t1sy: "FCB", t2sy: "VFB", t1g: 5, t2g: 1, mtd: "90", st: 2 },
      { mi: "11917", day: 1, dt: "2026-08-29T13:30:00Z", t1: "77", t2: "7",
        t1g: 3, t2g: 2, st: 2 },
    ] },
    { day: 2, mdln: "Spieltag 2", it: [
      { mi: "11965", day: 2, dt: "2026-09-04T18:30:00Z", t1: "9", t2: "28",
        st: 0, bo: { o1: 1.42, ox: 4.8, o2: 4.9 } },
    ] },
  ],
  day: 2,
};

const plan = leseSpielplan(MATCHDAYS);
pruefe("alle Partien flach", plan.length, 3);
pruefe("Heim und Gast", [plan[0].heim, plan[0].gast], ["2", "9"]);
pruefe("Spiel-ID als Text", plan[0].mi, "11914");
pruefe("Tore gelesen", [plan[0].toreHeim, plan[0].toreGast], [5, 1]);
pruefe("Spieltag aus dem Spiel", plan[2].spieltag, 2);

// **Gewertet ist, was Tore trägt** – nicht, was einen Statuscode hat.
pruefe("gespielt = gewertet", plan[0].gewertet, true);
pruefe("kommend = nicht gewertet", plan[2].gewertet, false);
pruefe("kommende Partie ohne Tore", [plan[2].toreHeim, plan[2].toreGast], [null, null]);

// Ein 0:0 ist gewertet – die Null ist ein Ergebnis, kein fehlender Wert.
const null_zu_null = leseSpielplan({ it: [{ day: 1, it: [
  { mi: "1", t1: "2", t2: "3", t1g: 0, t2g: 0 }] }] });
pruefe("0:0 zaehlt als gewertet", null_zu_null[0].gewertet, true);

pruefe("leere Antwort", leseSpielplan({}), []);
pruefe("Muell faellt raus", leseSpielplan({ it: [{ it: [{ mi: "1" }] }] }), []);

// ── Die Saison ─────────────────────────────────────────────────────
const REIHE = {
  it: [
    { sid: "25", ti: "2024/2025", ph: [{ mi: "7302", day: 1, p: 156, pt: "7" }] },
    { sid: "42", ti: "2026/2027", ph: [
      { mi: "11914", day: 1, p: 35, pt: "2", cur: true },
      { mi: "11944", day: 2, pt: "2", cur: false },
    ] },
  ],
};
pruefe("laufende Saison an cur erkannt", aktuelleSaison(REIHE).ti, "2026/2027");
pruefe("ohne cur die letzte", aktuelleSaison({ it: [{ ti: "a", ph: [] }, { ti: "b", ph: [] }] }).ti, "b");
pruefe("gar keine Saison", aktuelleSaison({}), null);

const l = leseLeistungen(REIHE);
pruefe("nur die laufende Saison", l.length, 2);
pruefe("Punkte und Verein", [l[0].punkte, l[0].team], [35, "2"]);
// **Ohne p bleibt null** – bei einer kommenden Partie ist 0 eine Behauptung.
pruefe("kommendes Spiel ohne Punkte", l[1].punkte, null);
pruefe("Eintrag ohne Verein faellt raus",
  leseLeistungen({ it: [{ ph: [{ mi: "1", p: 5 }] }] }), []);

// ── Mannschaftspunkte ──────────────────────────────────────────────
// Zwei Spieler von Verein 2, einer von Verein 9, ein gewertetes Spiel.
const LEISTUNGEN = [
  { mi: "11914", team: "2", punkte: 35 },
  { mi: "11914", team: "2", punkte: 65 },
  { mi: "11914", team: "9", punkte: 12 },
  // Ein Spieler ohne Punkte in einem gespielten Spiel: er hat nichts
  // beigetragen – das ist eine 0, kein fehlender Wert.
  { mi: "11914", team: "9", punkte: null },
  // Und ein kommendes Spiel, das nicht mitzählen darf.
  { mi: "11965", team: "9", punkte: null },
];
const summen = mannschaftsPunkte(LEISTUNGEN, plan);
pruefe("nur gewertete Partien", summen.length, 2);
pruefe("Heimsumme", summen[0].punkteHeim, 100);
pruefe("Gastsumme, fehlender Wert zaehlt als 0", summen[0].punkteGast, 12);
pruefe("Partie ohne Leistungen bleibt leer",
  [summen[1].punkteHeim, summen[1].punkteGast], [null, null]);
pruefe("kommende Partie kommt nicht vor",
  summen.some((s) => s.mi === "11965"), false);

console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
