// Spielplan und Punkte je Spiel — beides an echten Daten belegt.
//
// **Der Spielplan** steht unter `/v4/competitions/1/matchdays`: alle 34
// Spieltage in einem einzigen Aufruf, je Partie `mi` (Spiel-ID), `t1`/`t2`
// (Heim/Gast), `dt` und — sobald gespielt — `t1g`/`t2g` (Tore).
//
// **Die Punkte** stehen in `/v4/competitions/1/players/{pid}/performance`:
// je Spieler eine Reihe über **vierzehn Saisons**, und darin je Spiel `mi`,
// `p` (seine Punkte) und `pt` (**seine Mannschaft in diesem Spiel**).
//
// `pt` ist der Grund, warum das überhaupt trägt: Die Zuordnung Spieler →
// Verein gilt für den Zeitpunkt des Spiels, nicht für heute. Ein Spieler,
// der im Winter gewechselt ist, zählt korrekt für beide Vereine.
//
// Reine Auswertung, keine Datenbank.

function zahl(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

// Alle Partien aus der Spieltagsliste, flach.
//
// **Gewertet ist, was Tore trägt.** Kommende Partien lassen `t1g`/`t2g`
// einfach weg — das ist die Form, an der man sie erkennt, und sie ist
// verlässlicher als ein Statuscode, dessen Bedeutung wir nicht kennen.
export function leseSpielplan(daten) {
  const spieltage = Array.isArray(daten?.it) ? daten.it : [];
  const raus = [];

  for (const tag of spieltage) {
    for (const s of Array.isArray(tag?.it) ? tag.it : []) {
      const mi = s?.mi == null ? null : String(s.mi);
      const heim = s?.t1 == null ? null : String(s.t1);
      const gast = s?.t2 == null ? null : String(s.t2);
      if (!mi || !heim || !gast) continue;

      const toreHeim = zahl(s.t1g);
      const toreGast = zahl(s.t2g);
      raus.push({
        mi,
        spieltag: zahl(s.day ?? tag?.day),
        datum: typeof s.dt === "string" ? s.dt : null,
        heim,
        gast,
        toreHeim,
        toreGast,
        gewertet: toreHeim != null && toreGast != null,
      });
    }
  }
  return raus;
}

// Die laufende Saison aus der Leistungsreihe eines Spielers.
//
// Erkannt an `cur: true` an einem Spiel — das setzt Kickbase am aktuellen
// Spieltag. Fehlt es (Sommerpause), gilt der letzte Eintrag: Die Liste ist
// chronologisch, die jüngste Saison steht hinten.
export function aktuelleSaison(daten) {
  const saisons = Array.isArray(daten?.it) ? daten.it : [];
  if (saisons.length === 0) return null;
  const mitLaufendem = saisons.find((s) =>
    (Array.isArray(s?.ph) ? s.ph : []).some((e) => e?.cur === true));
  return mitLaufendem ?? saisons[saisons.length - 1];
}

// Was ein Spieler in welchem Spiel für welche Mannschaft geholt hat.
//
// **Ohne `p` bleibt der Wert `null`, nicht 0.** Bei einer kommenden Partie
// steht dort nichts, und eine 0 würde die Mannschaft als punktlos zeigen.
// Was daraus wird, entscheidet die Auswertung: Nur bei einem gewerteten
// Spiel zählt ein fehlender Wert als „nicht gepunktet".
export function leseLeistungen(daten) {
  const saison = aktuelleSaison(daten);
  const spiele = Array.isArray(saison?.ph) ? saison.ph : [];

  return spiele
    .map((e) => ({
      mi: e?.mi == null ? null : String(e.mi),
      team: e?.pt == null ? null : String(e.pt),
      spieltag: zahl(e?.day),
      punkte: zahl(e?.p),
    }))
    .filter((e) => e.mi && e.team);
}

// Aus Einzelleistungen die Mannschaftspunkte je Spiel.
//
// `leistungen`: [{ mi, team, punkte }], `spiele`: aus leseSpielplan().
// Gezählt wird **nur bei gewerteten Partien** — sonst stünde vor dem
// Anpfiff überall eine 0.
export function mannschaftsPunkte(leistungen, spiele) {
  const gewertet = new Set(
    (spiele ?? []).filter((s) => s.gewertet).map((s) => s.mi));

  const summen = new Map();
  for (const l of leistungen ?? []) {
    if (!gewertet.has(l.mi)) continue;
    const schl = `${l.mi}|${l.team}`;
    summen.set(schl, (summen.get(schl) ?? 0) + (l.punkte ?? 0));
  }

  return (spiele ?? [])
    .filter((s) => s.gewertet)
    .map((s) => ({
      ...s,
      punkteHeim: summen.get(`${s.mi}|${s.heim}`) ?? null,
      punkteGast: summen.get(`${s.mi}|${s.gast}`) ?? null,
    }));
}
