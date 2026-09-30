// Der Spielplan — an echten Daten belegt.
//
// Er steht unter `/v4/competitions/1/matchdays`: alle 34 Spieltage in einem
// einzigen Aufruf, je Partie `mi` (Spiel-ID), `t1`/`t2` (Heim/Gast), `dt`
// und — sobald gespielt — `t1g`/`t2g` (Tore).
//
// Hier stand einmal auch die Auswertung der **Leistungsreihe je Spieler**
// (`leseLeistungen`, `mannschaftsPunkte`). Sie trug allein die Gegner-Seite
// und ist mit ihr rausgeflogen; der Spielplan bleibt, weil an ihm hängt, für
// welchen Spieltag die Startelf-Prognose gilt.
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

// ── Die Leistungsreihe eines Spielers ───────────────────────────────
//
// `/v4/competitions/1/players/{pid}/performance` — an echten Daten belegt
// (damals für die Gegner-Seite): je Saison eine Reihe `ph` mit `mi`
// (Spiel), `day` (Spieltag), `p` (Punkte) und `pt`.
//
// **`pt` ist der Grund, warum das trägt:** Es ist der Verein des Spielers
// ZUM ZEITPUNKT DES SPIELS. Mit dem heutigen Kader gerechnet, wäre nach
// einem Wechsel jedes frühere Spiel dem falschen Verein zugeordnet.

// Die laufende Saison: die mit dem Eintrag `cur`, sonst die letzte.
export function aktuelleSaison(daten) {
  const saisons = Array.isArray(daten?.it) ? daten.it : [];
  if (saisons.length === 0) return null;
  const mitLaufendem = saisons.find((s) =>
    (Array.isArray(s?.ph) ? s.ph : []).some((e) => e?.cur === true));
  return mitLaufendem ?? saisons[saisons.length - 1];
}

// Was ein Spieler in welchem Spiel für welchen Verein geholt hat.
//
// **Ohne `p` bleibt der Wert `null`, nicht 0.** Bei einer kommenden Partie
// steht dort nichts, und eine 0 würde sie als gespielt ausgeben. Was
// daraus wird, entscheidet die Auswertung.
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
