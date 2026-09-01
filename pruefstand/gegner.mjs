// Der Gegner-Score: rechnet er das Richtige, und schweigt er, wenn nichts
// da ist?
import {
  GEWICHTE, RUECKHALT, gewertete, ligaSchnitt, zugestanden, faktoren,
  heimfaktor, gegnerScore, naechsteSpiele,
} from "../lib/gegner.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};
const nah = (name, ist, soll, tol = 0.01) => {
  if (ist != null && Math.abs(ist - soll) <= tol) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${ist}\n  soll: ~${soll}`); }
};

// Vier Mannschaften, jede zweimal gespielt. Bayern kassiert wenig,
// Heidenheim viel.
const SPIELE = [
  { spieltag: 1, heim: "BAY", gast: "HDH", punkteHeim: 900, punkteGast: 300 },
  { spieltag: 1, heim: "BVB", gast: "SGE", punkteHeim: 600, punkteGast: 600 },
  { spieltag: 2, heim: "HDH", gast: "BVB", punkteHeim: 400, punkteGast: 800 },
  { spieltag: 2, heim: "SGE", gast: "BAY", punkteHeim: 500, punkteGast: 700 },
];

// ── Grundgrößen ────────────────────────────────────────────────────
pruefe("nur gewertete Spiele", gewertete([...SPIELE, { heim: "A", gast: "B" }]).length, 4);
nah("Ligaschnitt", ligaSchnitt(SPIELE), (900+300+600+600+400+800+500+700) / 8);

const z = zugestanden(SPIELE);
pruefe("BAY gesteht zu", [z.get("BAY").spiele, z.get("BAY").punkte], [2, 300 + 500]);
pruefe("HDH gesteht zu", [z.get("HDH").spiele, z.get("HDH").punkte], [2, 900 + 800]);

// ── Faktoren ───────────────────────────────────────────────────────
const f = faktoren(SPIELE);
const schnitt = ligaSchnitt(SPIELE);
pruefe("Bayern ist der zäheste Gegner",
  f.get("BAY").faktor < f.get("SGE").faktor && f.get("SGE").faktor < f.get("HDH").faktor, true);
pruefe("HDH über dem Schnitt", f.get("HDH").faktor > 1, true);
pruefe("BAY unter dem Schnitt", f.get("BAY").faktor < 1, true);

// Der Rückhalt zieht zum Ligaschnitt: gerechnet von Hand nachvollzogen.
nah("BAY-Faktor mit Rückhalt",
  f.get("BAY").faktor, ((800 + RUECKHALT * schnitt) / (2 + RUECKHALT)) / schnitt);

// **Ein einziges Spiel darf nicht durchschlagen.** Ohne Rückhalt läge der
// Faktor bei 2,0 – mit Rückhalt deutlich näher an 1.
const einzeln = [{ spieltag: 1, heim: "A", gast: "B", punkteHeim: 1000, punkteGast: 500 }];
const fe = faktoren(einzeln);
pruefe("ein Ausreißer wird gedämpft", fe.get("A").faktor < 1.25 && fe.get("A").faktor > 0.8, true);
pruefe("roher Schnitt bleibt ablesbar", fe.get("A").schnitt, 500);

// ── Heimvorteil ────────────────────────────────────────────────────
const h = heimfaktor(SPIELE);
// In diesen vier Partien stehen 2400 Heim- gegen 2400 Auswärtspunkte –
// also kein Vorteil. Genau das muss herauskommen.
nah("ausgeglichen → beide 1", h.heim, 1);
nah("ausgeglichen → beide 1 (auswärts)", h.auswaerts, 1);
nah("Heim und Auswärts mitteln auf 1", (h.heim + h.auswaerts) / 2, 1);

// Und mit echtem Heimvorteil schlägt er durch.
const mitVorteil = heimfaktor([
  { heim: "A", gast: "B", punkteHeim: 700, punkteGast: 500 },
  { heim: "C", gast: "D", punkteHeim: 700, punkteGast: 500 },
]);
pruefe("Heimvorteil erkannt", mitVorteil.heim > mitVorteil.auswaerts, true);
nah("700 zu 500 → 1,167", mitVorteil.heim, 700 / 600);
pruefe("ohne Spiele neutral", heimfaktor([]), { heim: 1, auswaerts: 1, spiele: 0 });

// ── Der Score ──────────────────────────────────────────────────────
const neutral = { heim: 1, auswaerts: 1 };

// Fünfmal genau Ligaschnitt → Index 100
const durchschnitt = new Map([["X", { faktor: 1 }]]);
pruefe("lauter Durchschnittsgegner → 100",
  gegnerScore([1,2,3,4,5].map(() => ({ gegner: "X" })), durchschnitt, neutral).score, 100);

// Das nächste Spiel wiegt am schwersten: derselbe starke Gegner einmal
// vorne, einmal hinten.
const gemischt = new Map([["STARK", { faktor: 0.5 }], ["SCHWACH", { faktor: 1.5 }]]);
const vorne = gegnerScore(
  [{ gegner: "SCHWACH" }, ...Array(4).fill({ gegner: "STARK" })], gemischt, neutral).score;
const hinten = gegnerScore(
  [...Array(4).fill({ gegner: "STARK" }), { gegner: "SCHWACH" }], gemischt, neutral).score;
pruefe("vorne wiegt schwerer als hinten", vorne > hinten, true);
nah("Gewichte 5:4:3:2:1 – vorne", vorne, ((5*1.5 + 10*0.5) / 15) * 100, 1);
nah("Gewichte 5:4:3:2:1 – hinten", hinten, ((14*0.5 + 1*1.5) / 15) * 100, 1);

// Nur vier Spiele: die Gewichte werden auf das Vorhandene normiert.
pruefe("vier statt fünf Spiele",
  gegnerScore(Array(4).fill({ gegner: "X" }), durchschnitt, neutral).score, 100);

// Ein unbekannter Gegner wird nicht geraten
const einerFehlt = gegnerScore(
  [{ gegner: "X" }, { gegner: "UNBEKANNT" }, { gegner: "X" }], durchschnitt, neutral);
pruefe("unbekannter Gegner faellt raus", einerFehlt.score, 100);
pruefe("und wird als Lücke ausgewiesen",
  einerFehlt.teile.filter((t) => t.faktor == null).length, 1);
pruefe("beruecksichtigtes Gewicht", einerFehlt.beruecksichtigt, 5 + 3);

pruefe("gar keine Spiele → nichts", gegnerScore([], durchschnitt, neutral), null);
pruefe("nur Unbekannte → nichts",
  gegnerScore([{ gegner: "?" }], new Map(), neutral), null);

// Mehr als fünf Spiele: nur die ersten fünf zählen
pruefe("hoechstens fuenf",
  gegnerScore(Array(8).fill({ gegner: "X" }), durchschnitt, neutral).teile.length, 5);

// Heim/Auswärts schlägt durch
const mitOrt = { heim: 1.1, auswaerts: 0.9 };
pruefe("zu Hause besser bewertet",
  gegnerScore([{ gegner: "X", heim: true }], durchschnitt, mitOrt).score >
  gegnerScore([{ gegner: "X", heim: false }], durchschnitt, mitOrt).score, true);

// ── Die nächsten Spiele aus dem Plan ───────────────────────────────
const PLAN = [
  ...SPIELE,
  { spieltag: 3, heim: "BAY", gast: "BVB" },
  { spieltag: 4, heim: "SGE", gast: "BAY" },
  { spieltag: 5, heim: "BAY", gast: "HDH" },
];
const naechste = naechsteSpiele(PLAN, "BAY");
pruefe("nur ungespielte Partien", naechste.length, 3);
pruefe("Gegner richtig herum", naechste.map((s) => s.gegner), ["BVB", "SGE", "HDH"]);
pruefe("Heim richtig erkannt", naechste.map((s) => s.heim), [true, false, true]);
pruefe("nach Spieltag sortiert", naechste.map((s) => s.spieltag), [3, 4, 5]);
pruefe("fremde Mannschaft", naechsteSpiele(PLAN, "GIBTSNICHT"), []);
pruefe("leerer Plan", naechsteSpiele(null, "BAY"), []);

pruefe("fuenf Gewichte", GEWICHTE.length, 5);

console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
