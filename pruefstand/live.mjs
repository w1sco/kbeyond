// Findet die Live-Punkte-Suche das Richtige — und schweigt sie, wenn nichts da ist?
import { findePunkte, besterFund, sammleTreffer, LIVE_PFADE } from "../lib/live.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  const gleich = JSON.stringify(ist) === JSON.stringify(soll);
  if (gleich) { ok++; } else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};

const IDS = ["111", "222", "333"];

// 1) Der einfache Fall: Liste mit i und p
const einfach = { us: [ { i: "111", p: 42 }, { i: "222", p: 17 }, { i: "333", p: 0 } ] };
const f1 = besterFund(einfach, IDS);
pruefe("einfach: Feld gefunden", [f1?.idFeld, f1?.punkteFeld], ["i", "p"]);
pruefe("einfach: Werte", [...(f1?.treffer ?? [])], [["111",42],["222",17],["333",0]]);

// 2) Verschachtelt und mit Ablenkung: ein Marktwert-Feld daneben
const tief = { d: { ranking: { players: [
  { u: "111", mdp: 88, mv: 12000000, n: "A" },
  { u: "222", mdp: 12, mv: 4000000, n: "B" },
] } } };
const f2 = besterFund(tief, IDS);
pruefe("tief: ID-Feld", f2?.idFeld, "u");
pruefe("tief: Punktefeld (nicht der Marktwert)", f2?.punkteFeld, "mdp");
pruefe("tief: Pfad genannt", f2?.pfad, "d.ranking.players");

// 3) Ein Feld, in dem überall dasselbe steht, ist kein Punktestand
const stumpf = { us: [ { i: "111", p: 0, x: 5 }, { i: "222", p: 0, x: 5 } ] };
pruefe("alles gleich → kein Fund", besterFund(stumpf, IDS), null);

// 4) Fremde IDs → nichts
const fremd = { us: [ { i: "999", p: 42 }, { i: "888", p: 17 } ] };
pruefe("fremde IDs → nichts", besterFund(fremd, IDS), null);

// 5) Nur ein Treffer ist Zufall, kein Muster
const einer = { us: [ { i: "111", p: 42 }, { i: "999", p: 17 } ] };
pruefe("ein Treffer → nichts", besterFund(einer, IDS), null);

// 6) Marktwerte sind keine Punkte (über der Obergrenze)
const nurMw = { us: [ { i: "111", mv: 12000000 }, { i: "222", mv: 4000000 } ] };
pruefe("nur Marktwerte → nichts", besterFund(nurMw, IDS), null);

// 7) Zahlen als Zahlen, IDs als Zahlen (Kickbase mischt das)
const zahlIds = { us: [ { i: 111, p: 42 }, { i: 222, p: 17 } ] };
pruefe("numerische IDs", [...(besterFund(zahlIds, IDS)?.treffer ?? [])], [["111",42],["222",17]]);

// 8) Mehrere Kandidaten → sprechender Feldname gewinnt
const mehrere = { us: [ { i: "111", p: 42, rank: 1 }, { i: "222", p: 17, rank: 2 } ] };
pruefe("sprechender Name gewinnt", besterFund(mehrere, IDS)?.punkteFeld, "p");

// 9) Alle Kandidaten werden aufgelistet, nicht nur der beste
pruefe("mehrere Funde gelistet", findePunkte(mehrere, IDS).length >= 2, true);

// 10) Leere Eingaben
pruefe("null", besterFund(null, IDS), null);
pruefe("leere IDs", besterFund(einfach, []), null);
pruefe("leeres Objekt", besterFund({}, IDS), null);

// 11) Die Pfadliste ist vollständig und ohne Lücken
pruefe("Pfade mit uid", LIVE_PFADE(7, 9).some((p) => p.includes("managers/9")), true);
pruefe("Pfade ohne uid", LIVE_PFADE(7, null).some((p) => p.includes("managers/")), false);
pruefe("Liga-ID eingesetzt", LIVE_PFADE(7, 9).every((p) => !p.includes("undefined")), true);

// 12) Live-Punkte dürfen 0 sein — vor dem Anpfiff sind sie das immer
const vorAnpfiff = { us: [ { i: "111", p: 0, sp: 120 }, { i: "222", p: 0, sp: 90 } ] };
const f12 = besterFund(vorAnpfiff, IDS);
pruefe("vor Anpfiff: Saisonpunkte statt Nullspalte", f12?.punkteFeld, "sp");

// 13) Verschachtelte Listen je Manager werden zusammengefasst, nicht
//     nur die erste genommen. Genau hier ging der erste Anlauf schief.
const proManager = { d: { ranking: { players: [
  { u: "111", mdp: 80, pl: [ { pi: "a", mdp: 20 }, { pi: "b", mdp: 11 } ] },
  { u: "222", mdp: 63, pl: [ { pi: "c", mdp: 9 },  { pi: "d", mdp: 4 } ] },
  { u: "333", mdp: 46, pl: [ { pi: "e", mdp: 7 },  { pi: "f", mdp: 2 } ] },
] } } };
const alleSpieler = sammleTreffer(proManager, ["a","b","c","d","e","f"]);
pruefe("Spieler aller Manager", [...(alleSpieler?.treffer ?? [])].length, 6);
pruefe("Spieler-Feldpaar", [alleSpieler?.idFeld, alleSpieler?.punkteFeld], ["pi", "mdp"]);
pruefe("Manager trotz Verschachtelung", [...(besterFund(proManager, IDS)?.treffer ?? [])].length, 3);

// 14) Auch der vierte und spätere Manager wird besucht – nicht nur die
//     ersten drei.
const viele = { us: Array.from({ length: 18 }, (_, i) => ({
  u: String(100 + i),
  pl: [ { pi: `s${i}a`, mdp: i }, { pi: `s${i}b`, mdp: i + 1 } ],
})) };
const spaet = sammleTreffer(
  viele,
  Array.from({ length: 18 }, (_, i) => [`s${i}a`, `s${i}b`]).flat()
);
pruefe("alle 18 Spielerlisten", [...(spaet?.treffer ?? [])].length, 36);

// Eine Liste mit nur einem Treffer bleibt draußen: ein einzelner Treffer
// kann Zufall sein, und ein Feldpaar aus Zufall verdirbt alle anderen.
const einzeln = { us: [ { pi: "einer", mdp: 3 } ] };
pruefe("Einzelliste zählt nicht", sammleTreffer(einzeln, ["einer"]), null);

// 15) Ein anderes Feldpaar mischt sich nicht unter
const gemischt = { a: [ { pi: "x", mdp: 5 }, { pi: "y", mdp: 9 } ],
                   b: [ { pi: "z", mv: 700 }, { pi: "q", mv: 800 } ] };
const rein = sammleTreffer(gemischt, ["x","y","z","q"]);
pruefe("nur ein Feldpaar", [...(rein?.treffer ?? [])].map(([k]) => k).sort(), ["x","y"]);

pruefe("sammleTreffer ohne Fund", sammleTreffer({}, IDS), null);

console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
