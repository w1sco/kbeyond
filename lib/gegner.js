// Wie stark ist der Gegner — und wie günstig sind die nächsten fünf Spiele?
//
// Reine Rechnung, keine Datenbank: So lässt sie sich ohne Postgres
// durchrechnen (dieselbe Trennung wie bei gebot.js und loginbonus.js).
//
// Eingabe ist eine Liste gespielter Partien:
//   { spieltag, heim, gast, punkteHeim, punkteGast }
// „Punkte" sind Kickbase-Punkte aller Spieler einer Mannschaft in diesem
// Spiel — das ist die Größe, um die es dem Nutzer geht.

// Gewichte der nächsten fünf Spiele. Das nächste zählt am meisten, dann
// absteigend. Linear und nicht exponentiell, weil sich 5:4:3:2:1 jedem
// erklären lässt — das nächste Spiel trägt damit ein Drittel.
export const GEWICHTE = [5, 4, 3, 2, 1];

// **Wenig Daten sind kein Grund zu raten.** Am zweiten Spieltag hat jede
// Mannschaft ein einziges Spiel — ein Ausreißer bestimmte sonst die ganze
// Bewertung. Der Schnitt eines Teams wird deshalb zum Ligaschnitt
// hingezogen, als hätte es zusätzlich `RUECKHALT` Spiele mit genau
// durchschnittlichem Ausgang gespielt.
//
// Mit 3 zählt das erste echte Spiel zu einem Viertel, nach zehn Spielen
// zu drei Vierteln. Die Zahl steht hier und nicht verstreut im Code.
export const RUECKHALT = 3;

function istZahl(x) {
  return typeof x === "number" && Number.isFinite(x);
}

// Nur Partien, die wirklich gespielt und gewertet sind.
export function gewertete(spiele) {
  return (spiele ?? []).filter(
    (s) => s && istZahl(s.punkteHeim) && istZahl(s.punkteGast) && s.heim && s.gast
  );
}

// Der Ligaschnitt: Punkte, die eine Mannschaft in einem Spiel holt.
export function ligaSchnitt(spiele) {
  const g = gewertete(spiele);
  if (g.length === 0) return null;
  const summe = g.reduce((s, x) => s + x.punkteHeim + x.punkteGast, 0);
  return summe / (g.length * 2);
}

// Was eine Mannschaft ihren Gegnern **zugesteht**: die Punkte, die die
// jeweils andere Seite gegen sie geholt hat.
//
// Das ist die Größe, die zählt — nicht, wie viele Punkte die Mannschaft
// selbst macht. Wer auf Spieler setzen will, sucht den durchlässigen
// Gegner, nicht den schwachen Angriff.
export function zugestanden(spiele) {
  const raus = new Map();
  const nimm = (team) => {
    if (!raus.has(team)) raus.set(team, { spiele: 0, punkte: 0, heim: 0, heimSpiele: 0 });
    return raus.get(team);
  };

  for (const s of gewertete(spiele)) {
    const h = nimm(s.heim);
    h.spiele++; h.punkte += s.punkteGast;
    h.heim += s.punkteGast; h.heimSpiele++;

    const g = nimm(s.gast);
    g.spiele++; g.punkte += s.punkteHeim;
  }
  return raus;
}

// Der Faktor je Mannschaft: 1,0 = genau Ligaschnitt, 1,2 = gegen diese
// Mannschaft holt man ein Fünftel mehr als üblich.
export function faktoren(spiele) {
  const schnitt = ligaSchnitt(spiele);
  if (schnitt == null || schnitt <= 0) return new Map();

  const raus = new Map();
  for (const [team, z] of zugestanden(spiele)) {
    // Zum Ligaschnitt hingezogen – siehe RUECKHALT.
    const gemittelt = (z.punkte + RUECKHALT * schnitt) / (z.spiele + RUECKHALT);
    raus.set(team, {
      faktor: gemittelt / schnitt,
      schnitt: z.spiele > 0 ? z.punkte / z.spiele : null,
      spiele: z.spiele,
    });
  }
  return raus;
}

// Heimvorteil als **eine** Zahl für die ganze Liga, nicht je Mannschaft.
// Je Mannschaft wären es am zweiten Spieltag ein bis zwei Spiele — daraus
// lässt sich nichts ableiten. Über alle Partien zusammen schon.
export function heimfaktor(spiele) {
  const g = gewertete(spiele);
  if (g.length === 0) return { heim: 1, auswaerts: 1, spiele: 0 };
  const heim = g.reduce((s, x) => s + x.punkteHeim, 0) / g.length;
  const aus = g.reduce((s, x) => s + x.punkteGast, 0) / g.length;
  const mitte = (heim + aus) / 2;
  if (mitte <= 0) return { heim: 1, auswaerts: 1, spiele: g.length };
  return { heim: heim / mitte, auswaerts: aus / mitte, spiele: g.length };
}

// Der Score für eine Mannschaft über ihre nächsten Spiele.
//
// `kommende` ist eine Liste in zeitlicher Reihenfolge:
//   { gegner, heim: true|false }
//
// Ergebnis ist ein Index: **100 = Ligaschnitt**. 118 heißt, die nächsten
// fünf Gegner sind zusammen rund 18 % durchlässiger als der Schnitt.
export function gegnerScore(kommende, faktorMap, heim = { heim: 1, auswaerts: 1 }) {
  const liste = (kommende ?? []).slice(0, GEWICHTE.length);
  if (liste.length === 0) return null;

  let summe = 0;
  let gewicht = 0;
  const teile = [];

  liste.forEach((spiel, i) => {
    const w = GEWICHTE[i];
    const f = faktorMap.get(spiel.gegner)?.faktor;
    // Ein unbekannter Gegner wird nicht geraten – er fällt aus der
    // Rechnung, und die übrigen Gewichte tragen ihn mit.
    if (f == null) {
      teile.push({ ...spiel, faktor: null, gewicht: w });
      return;
    }
    const ort = spiel.heim ? heim.heim : heim.auswaerts;
    const wert = f * ort;
    summe += w * wert;
    gewicht += w;
    teile.push({ ...spiel, faktor: f, ortFaktor: ort, wert, gewicht: w });
  });

  if (gewicht === 0) return null;
  return { score: Math.round((summe / gewicht) * 100), teile, beruecksichtigt: gewicht };
}

// Die nächsten Spiele einer Mannschaft aus einem Spielplan mit noch
// nicht gewerteten Partien.
export function naechsteSpiele(spielplan, team, anzahl = GEWICHTE.length) {
  return (spielplan ?? [])
    .filter((s) => s && (s.heim === team || s.gast === team))
    .filter((s) => !istZahl(s.punkteHeim) || !istZahl(s.punkteGast))
    .sort((a, b) => (a.spieltag ?? 0) - (b.spieltag ?? 0))
    .slice(0, anzahl)
    .map((s) => ({
      spieltag: s.spieltag,
      gegner: s.heim === team ? s.gast : s.heim,
      heim: s.heim === team,
    }));
}
