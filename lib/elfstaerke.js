// Wie stark ist die Elf, die jeder Manager gerade aufgestellt hat?
//
// Gemessen am **Punkteschnitt der bisherigen Saison**: Für jeden
// aufgestellten Spieler sein Schnitt je Spiel (Kickbase-Feld `ap`, aus
// dem Kader), aufsummiert über die Aufstellung. Das ist keine Prognose,
// sondern eine Momentaufnahme: „Hätten alle wie bisher gepunktet, stünde
// diese Elf bei X."
//
// Was fehlt, fehlt sichtbar: Ein Spieler ohne Schnitt zählt als 0 und wird
// gezählt, nicht verschwiegen — eine zu niedrige Summe sähe sonst aus wie
// eine schwache Elf statt wie eine Datenlücke. Wer keine Aufstellung
// gespeichert hat, steht ohne Zahl am Ende, nicht mit 0 mittendrin.
//
// Reine Rechnung, keine Datenbank.

function zahl(x) {
  const n = Number(x);
  return x == null || !Number.isFinite(n) ? null : n;
}

export function bewerteElf({ manager = [], kaderProManager = new Map() } = {}) {
  const zeilen = manager.map((m) => {
    const id = String(m.i);
    const kader = kaderProManager.get(id) ?? [];
    const elf = kader
      .filter((s) => s.aufgestellt === true)
      .map((s) => ({ ...s, schnitt: zahl(s.schnitt) }))
      .sort((a, b) => (b.schnitt ?? -1) - (a.schnitt ?? -1));

    const ohneSchnitt = elf.filter((s) => s.schnitt == null).length;
    const summe = elf.reduce((s, x) => s + (x.schnitt ?? 0), 0);

    return {
      id,
      name: m.n,
      aufgestellt: elf.length,
      kader: kader.length,
      ohneSchnitt,
      // Ohne Aufstellung gibt es keine Summe — null, nicht 0.
      summe: elf.length ? summe : null,
      elf,
    };
  });

  // Erst die mit Summe, absteigend; dann die ohne Aufstellung, nach Name.
  zeilen.sort((a, b) => {
    if ((a.summe == null) !== (b.summe == null)) return a.summe == null ? 1 : -1;
    if (a.summe == null) return a.name.localeCompare(b.name);
    return b.summe - a.summe || a.name.localeCompare(b.name);
  });

  // Rang: gleiche Summe, gleicher Rang.
  let rang = 0;
  let vorher = null;
  zeilen.forEach((z, i) => {
    if (z.summe == null) { z.rang = null; return; }
    if (vorher == null || z.summe !== vorher) rang = i + 1;
    z.rang = rang;
    vorher = z.summe;
  });

  return zeilen;
}
