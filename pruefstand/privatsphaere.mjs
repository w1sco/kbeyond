// Wessen Zahlen sieht wer? Reine Rechnung, kein Server nötig.
//
// Die Zusage ist eng: Der Kontostand eines geschützten Managers steht
// nirgends mehr in dem, was an den Browser geht. Sich selbst sieht man
// immer.
import {
  wenVerbergen, verbergeKonten, verbergeTagesstand, GELDFELDER,
} from "../lib/privatsphaere.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};

const SPIELER = [
  { i: "1", n: "W1zco" },
  { i: "2", n: "Bruder" },
  { i: "3", n: "Lamlo" },
];

// ── Zuordnung Mensch → Manager ─────────────────────────────────────
const betreiber = { kb_uid: "1", name: "W1zco", zahlen_privat: true };
const bruder    = { kb_uid: "2", name: "Bruder", zahlen_privat: false };

pruefe("über die Kickbase-ID",
  [...wenVerbergen({ zugaenge: [betreiber, bruder], spieler: SPIELER })], ["1"]);

pruefe("sich selbst sieht man immer",
  [...wenVerbergen({ zugaenge: [betreiber], spieler: SPIELER, betrachterId: "1" })], []);

pruefe("wer nichts verbirgt, wird nicht verborgen",
  [...wenVerbergen({ zugaenge: [bruder], spieler: SPIELER })], []);

// Ohne ID greift der Name — dieselbe Reihenfolge wie bei der
// Selbstzuordnung auf der Ligaseite.
pruefe("ersatzweise über den Namen",
  [...wenVerbergen({ zugaenge: [{ kb_uid: null, name: "Lamlo", zahlen_privat: true }],
                     spieler: SPIELER })], ["3"]);

// Die ID sticht: Wer seinen Anzeigenamen ändert, bleibt verborgen.
pruefe("ID sticht den Namen",
  [...wenVerbergen({ zugaenge: [{ kb_uid: "1", name: "alter Name", zahlen_privat: true }],
                     spieler: SPIELER })], ["1"]);

// **Ein doppelter Name lässt sich nicht auflösen.** Dann werden beide
// verborgen — einmal zu viel ist harmlos, einmal zu wenig nicht.
const DOPPELT = [{ i: "1", n: "Fabinho" }, { i: "9", n: "Fabinho" }];
pruefe("doppelter Name verbirgt beide",
  [...wenVerbergen({ zugaenge: [{ kb_uid: null, name: "Fabinho", zahlen_privat: true }],
                     spieler: DOPPELT })], ["1", "9"]);

pruefe("unbekannter Mensch verbirgt niemanden",
  [...wenVerbergen({ zugaenge: [{ kb_uid: "77", name: "Fremder", zahlen_privat: true }],
                     spieler: SPIELER })], []);

pruefe("ohne Angaben passiert nichts", [...wenVerbergen({})], []);

// ── Das Verbergen selbst ───────────────────────────────────────────
const KONTEN = [
  { id: "1", name: "W1zco", konto: 50_000_000, teamwert: 180_000_000, punkte: 448,
    kaeufe: 9, verkaeufe: 8, strafen: -1, korrektur: 2, loginBonus: 3, punkteBonus: 4,
    bonusEcht: 5, bonusFormel: 6, limit: 7, maxGebot: 8, gesamtwert: 9,
    anzKauf: 11, anzVerkauf: 3, platz: 1 },
  { id: "2", name: "Bruder", konto: 12_000_000, teamwert: 90_000_000, punkte: 300 },
];

const verborgen = verbergeKonten(KONTEN, new Set(["1"]));

pruefe("jedes Geldfeld ist weg",
  GELDFELDER.filter((f) => verborgen[0][f] !== null), []);

// **null, nicht 0.** Eine 0 wäre eine Aussage — „er hat kein Geld".
pruefe("null statt 0", verborgen[0].konto, null);
pruefe("als verborgen gekennzeichnet", verborgen[0].finanzenGeheim, true);

// Was Kickbase selbst zeigt, bleibt stehen: sonst wäre es Theater.
pruefe("Teamwert bleibt", verborgen[0].teamwert, 180_000_000);
pruefe("Punkte bleiben", verborgen[0].punkte, 448);
pruefe("Platz bleibt", verborgen[0].platz, 1);
pruefe("Zahl der Käufe bleibt", verborgen[0].anzKauf, 11);
pruefe("Name bleibt", verborgen[0].name, "W1zco");

pruefe("die anderen sind unberührt", verborgen[1], KONTEN[1]);
pruefe("kein Kennzeichen bei den anderen", verborgen[1].finanzenGeheim, undefined);
pruefe("das Original bleibt heil", KONTEN[0].konto, 50_000_000);
pruefe("ohne Geheimnis unverändert", verbergeKonten(KONTEN, new Set()), KONTEN);

// ── Der Verlauf trägt dieselben Zahlen über die Zeit ───────────────
const TAGE = [
  { managerId: "1", tag: "2026-09-01", teamwert: 180, konto: 50, punkte: 400 },
  { managerId: "2", tag: "2026-09-01", teamwert: 90, konto: 12, punkte: 300 },
];
const tage = verbergeTagesstand(TAGE, new Set(["1"]));
pruefe("Kontolinie verschwindet", tage[0].konto, null);
pruefe("Kaderwertlinie bleibt", tage[0].teamwert, 180);
pruefe("Punktelinie bleibt", tage[0].punkte, 400);
pruefe("fremde Zeile unberührt", tage[1], TAGE[1]);

// Der Gesamtwert entsteht aus Teamwert + Konto. Fehlt das Konto, darf
// dort keine Linie stehen — sonst wäre der Kontostand eine Subtraktion
// weit weg.
pruefe("Gesamtwert ist ohne Konto nicht bildbar",
  tage.filter((z) => z.teamwert != null && z.konto != null).map((z) => z.managerId), ["2"]);

console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
