// Live-Punkte am Spieltag.
//
// ── Nicht raten, suchen ─────────────────────────────────────────────
//
// Welcher Endpunkt die Live-Punkte liefert und unter welchem Feld, ist
// nicht belegt. Wir haben aber einen Anker, den kein Rateversuch braucht:
// **die Manager-IDs kennen wir.** Gesucht wird deshalb eine Liste in der
// Antwort, deren Einträge diese IDs tragen — und daneben eine Zahl, die
// nach Punkten aussieht. Passt beides, ist es gefunden; passt nichts,
// wird nichts zurückgegeben statt etwas Falsches.

// Kandidaten für den Endpunkt. Reihenfolge egal — es zählt, was antwortet
// und worin sich die Manager-IDs finden.
export const LIVE_PFADE = (liga, uid) => [
  `/v4/leagues/${liga}/live`,
  `/v4/leagues/${liga}/livepoints`,
  `/v4/leagues/${liga}/ranking/live`,
  `/v4/leagues/${liga}/matchday`,
  `/v4/leagues/${liga}/matchdays`,
  `/v4/leagues/${liga}/ranking?live=1`,
  `/v4/leagues/${liga}/ranking?dayNumber=0`,
  `/v4/live/${liga}`,
  ...(uid ? [`/v4/leagues/${liga}/managers/${uid}/live`] : []),
  `/v4/competitions/1/matchdays`,
  `/v4/competitions/1/matches`,
];

// Feldnamen, die nach Punkten klingen. Kein Ausschluss — nur ein Vorrang,
// falls mehrere Felder passen.
const KLINGT_NACH_PUNKTEN = /^(p|pt|pts|points|sp|mdp|lp|lpt|livepoints|tp|t)$/i;

// Punkte eines Spieltags liegen realistisch in dieser Spanne. Alles
// darüber ist ein Marktwert, kein Punktestand.
const MAX_PUNKTE = 2000;

function istObjekt(x) {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

// Alle Listen finden, deren Einträge bekannte IDs tragen — samt dem Feld,
// das die Punkte hält.
export function findePunkte(daten, ids) {
  const bekannt = new Set([...(ids ?? [])].map(String));
  if (bekannt.size === 0) return [];

  const funde = [];

  const pruefeListe = (liste, pfad) => {
    const objekte = liste.filter(istObjekt);
    if (objekte.length < 2) return;

    const felder = new Set();
    for (const o of objekte) for (const k of Object.keys(o)) felder.add(k);

    for (const idFeld of felder) {
      const passend = objekte.filter((o) => bekannt.has(String(o[idFeld])));
      // Zwei Treffer können Zufall sein, drei kaum noch.
      if (passend.length < 2) continue;

      for (const punkteFeld of felder) {
        if (punkteFeld === idFeld) continue;
        const werte = passend.map((o) => Number(o[punkteFeld]));
        if (!werte.every((n) => Number.isFinite(n) && n >= 0 && n <= MAX_PUNKTE)) continue;

        funde.push({
          pfad: pfad || "(Wurzel)",
          idFeld,
          punkteFeld,
          abdeckung: passend.length,
          verschieden: new Set(werte).size,
          treffer: new Map(passend.map((o) => [String(o[idFeld]), Number(o[punkteFeld])])),
        });
      }
    }
  };

  const geh = (knoten, pfad, tiefe) => {
    if (tiefe > 5 || knoten == null || typeof knoten !== "object") return;
    if (Array.isArray(knoten)) {
      pruefeListe(knoten, pfad);
      // **Alle** Einträge weiterverfolgen, nicht nur die ersten. Die
      // Spielerlisten hängen je Manager einzeln im Baum – wer hier abkürzt,
      // sieht nur die Elf der ersten paar Manager.
      for (const x of knoten) geh(x, `${pfad}[]`, tiefe + 1);
      return;
    }
    for (const [k, v] of Object.entries(knoten)) {
      geh(v, pfad ? `${pfad}.${k}` : k, tiefe + 1);
    }
  };

  geh(daten, "", 0);

  // Bester Fund zuerst: sprechender Feldname, viele Manager, und Werte,
  // die sich unterscheiden — ein Feld, in dem überall dasselbe steht,
  // sagt nichts.
  return funde.sort((a, b) => punkte(b) - punkte(a));
}

function punkte(f) {
  return (
    (KLINGT_NACH_PUNKTEN.test(f.punkteFeld) ? 100 : 0) +
    (f.verschieden > 1 ? 40 : 0) +
    f.abdeckung
  );
}

// Der beste Fund, oder nichts.
export function besterFund(daten, ids) {
  const alle = findePunkte(daten, ids);
  // Ein Feld, in dem bei allen dasselbe steht, ist kein Punktestand.
  const brauchbar = alle.filter((f) => f.verschieden > 1);
  return brauchbar[0] ?? null;
}

// Alle Treffer eines Feldpaars zusammenfassen.
//
// Die Spielerlisten hängen je Manager einzeln im Baum: `players[0].pl`,
// `players[1].pl`, … Jede für sich ist ein eigener Fund. Wer nur den
// besten nimmt, bekommt die Elf **eines** Managers und hält den Rest für
// nicht vorhanden — genau das ist beim ersten Anlauf passiert.
export function sammleTreffer(daten, ids) {
  const alle = findePunkte(daten, ids).filter((f) => f.verschieden > 1);
  const bester = alle[0];
  if (!bester) return null;

  const zusammen = new Map();
  for (const f of alle) {
    // Nur Funde desselben Feldpaars – sonst mischt sich ein anderes Feld
    // (etwa der Marktwert) unter die Punkte.
    if (f.idFeld !== bester.idFeld || f.punkteFeld !== bester.punkteFeld) continue;
    for (const [id, wert] of f.treffer) zusammen.set(id, wert);
  }
  return { idFeld: bester.idFeld, punkteFeld: bester.punkteFeld, treffer: zusammen };
}
