// Matchups: zugelassene Punkte je Verein und Position. Reine Rechnung.
import {
  werteMatchupsAus, vollstaendigeSeiten, werIstOffen, bereichFuer, naechsterGegner,
  teileAuf, letzteEnden, programm, naechsteGegner,
} from "../lib/matchup.js";
import { leseLeistungen } from "../lib/spielplan.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};
const tag = (d, h = 15) => new Date(Date.UTC(2026, 8, d, h, 30)).toISOString();

// Drei Vereine A, B, C. Spieltag 1: A–B, Spieltag 2: C–A, Spieltag 3: B–C
// (gespielt), Spieltag 4: A–C (kommt noch).
const SPIELE = [
  { mi: "1", spieltag: 1, heim: "A", gast: "B", datum: tag(1), gewertet: true },
  { mi: "2", spieltag: 2, heim: "C", gast: "A", datum: tag(8), gewertet: true },
  { mi: "3", spieltag: 3, heim: "B", gast: "C", datum: tag(15), gewertet: true },
  { mi: "4", spieltag: 4, heim: "A", gast: "C", datum: tag(22), gewertet: false },
];
const L = (mi, team, position, punkte) => ({ mi, team, position, punkte });
const LEISTUNGEN = [
  // Spiel 1: A holt 100 (Sturm 60, Abwehr 40), B holt 50 (Sturm 50)
  L("1", "A", "ANG", 60), L("1", "A", "ABW", 40), L("1", "B", "ANG", 50),
  // Spiel 2: C holt 200 (Sturm 200), A holt 10 (MF 10)
  L("2", "C", "ANG", 200), L("2", "A", "MF", 10),
  // Spiel 3: B holt 30 (TW 30), C holt 70 (Sturm 70), dazu einer ohne Position
  L("3", "B", "TW", 30), L("3", "C", "ANG", 70), L("3", "C", null, 5),
];
const ALLE = new Set(["1|A", "1|B", "2|A", "2|C", "3|B", "3|C"]);

// ── Zeitraum ────────────────────────────────────────────────────────
pruefe("letzte 2 = Spieltag 2–3", bereichFuer(SPIELE, 2), { von: 2, bis: 3 });
pruefe("ganze Saison = ab 1", bereichFuer(SPIELE, null), { von: 1, bis: 3 });
pruefe("letzte 5 bei 3 Spieltagen = ab 1", bereichFuer(SPIELE, 5), { von: 1, bis: 3 });
pruefe("ohne gewertete Partie kein Bereich", bereichFuer([SPIELE[3]], 5), null);

// ── Die Auswertung ──────────────────────────────────────────────────
const { zeilen, ohnePosition } = werteMatchupsAus({
  spiele: SPIELE, leistungen: LEISTUNGEN, vollstaendig: ALLE, bereich: { von: 1, bis: 3 } });
const z = Object.fromEntries(zeilen.map((x) => [x.team, x]));

// A spielte gegen B (B holte 50) und gegen C (C holte 200): 250 in 2 Spielen
pruefe("A lässt gesamt 125 je Spiel zu", z.A.jePosition.alle.schnitt, 125);
pruefe("A lässt im Sturm 125 je Spiel zu", z.A.jePosition.ANG.schnitt, 125);
pruefe("A lässt im Tor nichts zu", z.A.jePosition.TW.schnitt, 0);
pruefe("A: zwei Spiele gezählt", z.A.spiele, 2);
// B spielte gegen A (100) und C (75, davon 5 ohne Position)
pruefe("B gesamt: (100 + 75) / 2", z.B.jePosition.alle.schnitt, 87.5);
pruefe("B Sturm: (60 + 70) / 2", z.B.jePosition.ANG.schnitt, 65);
pruefe("B Abwehr: 40 / 2", z.B.jePosition.ABW.schnitt, 20);
pruefe("ohne Position zählt nur in Gesamt", ohnePosition, 1);
// C spielte gegen A (10) und B (30)
pruefe("C gesamt: (10 + 30) / 2", z.C.jePosition.alle.schnitt, 20);
pruefe("Die eigenen Punkte zählen nicht als zugelassen", z.C.jePosition.ANG.schnitt, 0);

pruefe("Rang gesamt: A lässt am meisten zu", z.A.jePosition.alle.rang, 1);
pruefe("Rang gesamt: C am wenigsten", z.C.jePosition.alle.rang, 3);
pruefe("Rang Tor: gleicher Schnitt teilt den Rang", [z.A.jePosition.TW.rang, z.B.jePosition.TW.rang], [2, 2]);
pruefe("Rang Tor: C lässt 30/2 zu und ist vorn", z.C.jePosition.TW.rang, 1);

pruefe("nächster Gegner von A: C, zu Hause", z.A.naechster && [z.A.naechster.gegner, z.A.naechster.heim], ["C", true]);
pruefe("B hat kein kommendes Spiel mehr", z.B.naechster, null);
pruefe("naechsterGegner direkt", naechsterGegner(SPIELE, "C").gegner, "A");

// ── Zeitraum schneidet ──────────────────────────────────────────────
const nur3 = werteMatchupsAus({ spiele: SPIELE, leistungen: LEISTUNGEN, vollstaendig: ALLE, bereich: { von: 3, bis: 3 } });
const z3 = Object.fromEntries(nur3.zeilen.map((x) => [x.team, x]));
pruefe("nur Spieltag 3: A hat kein Spiel, kein Schnitt", z3.A.jePosition.alle.schnitt, null);
pruefe("… und keinen Rang", z3.A.jePosition.alle.rang, null);
pruefe("nur Spieltag 3: B lässt 75 zu", z3.B.jePosition.alle.schnitt, 75);
pruefe("ein Spiel ist „wenig Daten“", z3.B.wenig, true);

// ── Sicherung 1: halb geladene Seite zählt nicht ───────────────────
// Im Spiel 2 fehlt die Seite von C noch. Dann darf A dort NICHT mit 0
// zugelassenen Punkten dastehen, sondern die Partie ist offen.
const halb = new Set([...ALLE].filter((s) => s !== "2|C"));
const zh = Object.fromEntries(werteMatchupsAus({
  spiele: SPIELE, leistungen: LEISTUNGEN, vollstaendig: halb, bereich: { von: 1, bis: 3 } })
  .zeilen.map((x) => [x.team, x]));
pruefe("halbe Seite: A zählt nur Spiel 1", [zh.A.spiele, zh.A.offen], [1, 1]);
pruefe("halbe Seite: A lässt 50 zu, nicht (50+0)/2", zh.A.jePosition.alle.schnitt, 50);
pruefe("halbe Seite: C ist davon nicht betroffen (A-Seite komplett)", zh.C.spiele, 2);

// ── Sicherung 2: kommende Partien zählen nicht ─────────────────────
pruefe("Spiel 4 ist nicht gewertet und zählt nirgends", zeilen.every((x) => x.spiele <= 2), true);

// ── Vollständigkeit an der Uhrzeit, nicht an der Nummer ─────────────
const KADER = new Map([["A", ["a1", "a2"]], ["B", ["b1"]], ["C", ["c1"]]]);
const ende1 = Date.parse(tag(1)) + 3 * 3600_000;
const ende2 = Date.parse(tag(8)) + 3 * 3600_000;
const geprueftAm = new Map([
  ["a1", ende2 + 1], ["a2", ende1 + 1],   // a2 zuletzt vor Spiel 2 gefragt
  ["b1", ende1 - 1],                       // b1 VOR Ende von Spiel 1 gefragt
  ["c1", ende2 + 1],
]);
const v = vollstaendigeSeiten({ spiele: SPIELE.slice(0, 2), kader: KADER, geprueftAm });
pruefe("A in Spiel 1 komplett", v.has("1|A"), true);
pruefe("A in Spiel 2 nicht: a2 wurde davor gefragt", v.has("2|A"), false);
pruefe("B in Spiel 1 nicht: vor Spielende gefragt", v.has("1|B"), false);
pruefe("C in Spiel 2 komplett", v.has("2|C"), true);
pruefe("ohne Kader kein Beleg", vollstaendigeSeiten({
  spiele: SPIELE.slice(0, 1), kader: new Map(), geprueftAm }).size, 0);

// Der Samstagsfall: Spieltag halb gespielt. Wer vor dem Sonntagsspiel
// gefragt wurde, muss danach noch einmal dran.
const offen = werIstOffen({ spiele: SPIELE.slice(0, 2), kader: KADER, geprueftAm, jetzt: ende2 + 10 });
pruefe("offen: a2 (vor Spiel 2) und b1 (vor Ende Spiel 1)", offen.sort(), ["a2", "b1"]);
pruefe("ein laufendes Spiel macht niemanden offen", werIstOffen({
  spiele: SPIELE.slice(0, 2), kader: KADER, geprueftAm: new Map(), jetzt: Date.parse(tag(1)) + 3600_000 }), []);
pruefe("Verein ohne beendete Partie: niemand offen", werIstOffen({
  spiele: [SPIELE[3]], kader: KADER, geprueftAm: new Map(), jetzt: ende2 }), []);

// ── Wer ohne Aufruf abgehakt werden darf ───────────────────────────
// Alle drei Bedingungen: Feld belegt, Spielerliste jünger als das Spiel,
// Saisonpunkte unverändert. Jede einzeln verletzt heißt: fragen.
{
  const teamVon = new Map([["a1", "A"], ["a2", "A"], ["b1", "B"], ["c1", "C"]]);
  const letztesEnde = new Map([["A", 1000], ["B", 1000], ["C", 1000]]);
  const basis = {
    teamVon, letztesEnde, poolStand: 2000,
    tpJetzt:  new Map([["a1", 30], ["a2", 50], ["b1", 0],  ["c1", 12]]),
    tpDamals: new Map([["a1", 30], ["a2", 40], ["b1", 0],  ["c1", 12]]),
    tpPasst:  new Map([["a1", true], ["a2", true], ["b1", true], ["c1", false]]),
  };
  const t = teileAuf({ ...basis, offen: ["a1", "a2", "b1", "c1"] });
  pruefe("unverändert und belegt: abgehakt", t.ueberspringen, ["a1", "b1"]);
  pruefe("Punkte bewegt oder Feld nicht belegt: fragen", t.fragen, ["a2", "c1"]);
  pruefe("Spielerliste älter als das Spiel: alle fragen",
    teileAuf({ ...basis, poolStand: 500, offen: ["a1", "b1"] }).fragen, ["a1", "b1"]);
  pruefe("ohne Spielerliste-Stand: alle fragen",
    teileAuf({ ...basis, poolStand: null, offen: ["a1"] }).fragen, ["a1"]);
  pruefe("ohne tp in der Liste: fragen",
    teileAuf({ ...basis, tpJetzt: new Map(), offen: ["a1"] }).fragen, ["a1"]);
  pruefe("nie gefragt, also nie belegt: fragen",
    teileAuf({ ...basis, tpPasst: new Map(), offen: ["a1"] }).fragen, ["a1"]);
  pruefe("0 Punkte bleibt 0: abgehakt, nicht mit null verwechselt",
    teileAuf({ ...basis, offen: ["b1"] }).ueberspringen, ["b1"]);
}
pruefe("letzteEnden: nur beendete Partien",
  [...letzteEnden(SPIELE, Date.parse(tag(8)) + 3600_000).keys()].sort(), ["A", "B"]);

// ── Das Programm: die nächsten Gegner ──────────────────────────────
{
  const Z = (team, alle, ang, wenig = false) => ({
    team, wenig, jePosition: { alle: { schnitt: alle }, ANG: { schnitt: ang } } });
  const zeilen = [Z("A", 10, 4), Z("B", 20, 8, true), Z("C", 30, 12), Z("D", null, null)];
  const K = (spieltag, heim, gast) => ({ mi: `k${spieltag}${heim}`, spieltag, heim, gast, gewertet: false });
  const spiele = [
    // schon gespielt: zählt nicht als „nächster Gegner“
    { mi: "alt", spieltag: 4, heim: "A", gast: "D", gewertet: true },
    K(6, "C", "A"), K(6, "D", "B"),       // absichtlich vor Spieltag 5 notiert
    K(5, "A", "B"), K(5, "C", "D"),
    K(7, "A", "D"), K(7, "B", "C"),
  ];

  pruefe("nächste Gegner nach Spieltag, gewertete nicht",
    naechsteGegner(spiele, "A", 3).map((g) => g.gegner), ["B", "C", "D"]);
  pruefe("aus Sicht des Vereins: zu Hause / auswärts",
    [naechsteGegner(spiele, "A", 1)[0].heim, naechsteGegner(spiele, "B", 1)[0].heim], [true, false]);

  const p1 = programm({ spiele, zeilen, position: "alle", anzahl: 1 });
  const r1 = Object.fromEntries(p1.map((r) => [r.team, r]));
  pruefe("1 Spieltag: D trifft auf C (30)", r1.D.schnitt, 30);
  pruefe("1 Spieltag: A trifft auf B (20)", r1.A.schnitt, 20);
  pruefe("1 Spieltag: Reihenfolge nach Schnitt, Unbekannte hinten",
    p1.map((r) => r.team), ["D", "A", "B", "C"]);
  pruefe("1 Spieltag: C gegen D ohne Daten — kein Schnitt, kein Rang",
    [r1.C.schnitt, r1.C.rang, r1.C.bekannt], [null, null, 0]);

  const p3 = programm({ spiele, zeilen, position: "alle", anzahl: 3 });
  const r3 = Object.fromEntries(p3.map((r) => [r.team, r]));
  pruefe("3 Spieltage: D gegen C, B, A = (30+20+10)/3", r3.D.schnitt, 20);
  pruefe("3 Spieltage: D ist Rang 1", r3.D.rang, 1);
  // Die Falle der alten Gegner-Seite: Bei unvollständigen Gegnern KEIN
  // Schnitt aus den bekannten — der sähe aus wie ein echter.
  pruefe("2 von 3 Gegnern bekannt: kein Schnitt", [r3.A.schnitt, r3.A.bekannt], [null, 2]);
  pruefe("… und kein Rang", r3.A.rang, null);
  pruefe("wenig Daten bei einem Gegner färbt ab", r3.D.wenig, true);
  pruefe("Werte je Gegner stehen einzeln da", r3.D.gegner.map((g) => g.schnitt), [30, 20, 10]);

  const p5 = programm({ spiele, zeilen, position: "alle", anzahl: 5 });
  const r5 = Object.fromEntries(p5.map((r) => [r.team, r]));
  pruefe("Saisonende: nur 3 Partien übrig, Schnitt über 3", [r5.D.gegner.length, r5.D.schnitt], [3, 20]);

  const pa = Object.fromEntries(programm({ spiele, zeilen, position: "ANG", anzahl: 1 }).map((r) => [r.team, r]));
  pruefe("Position ANG: D gegen C lässt 12 zu", pa.D.schnitt, 12);
  pruefe("ohne kommende Partie: kein Schnitt",
    programm({ spiele: [], zeilen, anzahl: 3 }).every((r) => r.schnitt == null), true);
}

// ── Die Leistungsreihe lesen ────────────────────────────────────────
const reihe = { it: [
  { ti: "2025/2026", ph: [{ mi: "8000", day: 1, p: 99, pt: "7" }] },
  { ti: "2026/2027", ph: [
    { mi: "9000", day: 1, p: 40, pt: "7", cur: true },
    { mi: "9001", day: 2, p: -5, pt: "7" },
    { mi: "9002", day: 3, pt: "7" },
    { mi: "9003", day: 4, p: 12 },           // ohne Verein: fällt raus
  ] },
] };
const gelesen = leseLeistungen(reihe);
pruefe("laufende Saison über cur", gelesen.map((x) => x.mi), ["9000", "9001", "9002"]);
pruefe("negative Punkte bleiben negativ", gelesen[1].punkte, -5);
pruefe("ohne p bleibt null, nicht 0", gelesen[2].punkte, null);
pruefe("Verein zum Zeitpunkt des Spiels", gelesen[0].team, "7");
pruefe("leere Antwort", leseLeistungen({}), []);

console.log(`matchup: ${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
