// Wer steht in der echten Startelf?
//
// Unter welchem Feld Kickbase das kennzeichnet, ist nicht belegt. Statt zu
// raten wird gesucht — mit Proben, die sich selbst beweisen: Gesucht ist
// ein Feld, das **genau elf** Spieler auszeichnet. Bei 15 bis 20 Spielern
// im Kader ist das ein starkes Kennzeichen.
//
// Drei Muster, weil eine Aufstellung auf drei Arten kodiert sein kann:
//
//   1. **Reihenfolge**  1..11 für die Startelf, 12..18 für die Bank
//   2. **Wahrheitswert** true für die Startelf
//   3. **Status-Code**   z. B. 1 = Startelf, 2 = Bank, 0 = außen vor
//
// Die erste Fassung kannte nur eine Mischform und verlangte, dass alle
// übrigen Spieler „leer, false oder 0" sind. Genau daran scheiterte sie an
// den beiden wahrscheinlichsten Formen: Eine durchnummerierte Bank (12..18)
// ist nicht „aus", und ein Status 2 für die Bank zählte fälschlich als
// markiert.
export const ELF = 11;

// Bekannte Kandidaten zuerst. Danach wird jedes andere Feld probiert —
// der Name ist ja gerade unbekannt.
const KANDIDATEN = [
  "lo", "lineup_order", "lineupOrder", "lineup", "lineupPosition", "lp",
  "lineup_status", "lineupStatus", "lst", "st", "mdst", "stx", "inLineup", "ins", "start", "sta",
];

// Felder, deren Bedeutung wir kennen. Sie können die Aufstellung nicht sein
// und würden sonst zufällig passen — ein Positionsfeld mit vier Werten oder
// eine ID mit kleinen Zahlen.
const GESPERRT = new Set([
  "i", "id", "pi", "pid", "uid", "tid", "teamid",
  "pos", "position", "mv", "marketvalue", "prc", "price", "mvgl", "mvt",
  "p", "tp", "ap", "totalpoints", "averagepoints", "n", "fn", "ln", "name",
]);

const zahl = (w) => {
  if (typeof w === "boolean" || w == null || w === "") return null;
  const n = Number(w);
  return Number.isInteger(n) ? n : null;
};

// 1. Reihenfolge: die Startelf trägt 1..11, lückenlos und ohne Dopplung.
function alsReihenfolge(werte) {
  const klein = werte.map(zahl).map((n) => (n != null && n >= 1 && n <= ELF ? n : null));
  const vorhanden = klein.filter((n) => n != null);
  if (vorhanden.length !== ELF) return null;
  if (new Set(vorhanden).size !== ELF) return null;
  return klein.map((n) => n != null);
}

// 2. Wahrheitswert: genau elf echte true.
function alsWahrheit(werte) {
  const drin = werte.map((w) => w === true);
  return drin.filter(Boolean).length === ELF ? drin : null;
}

// 3. Status-Code: wenige verschiedene Werte, einer davon genau elfmal.
//
// Welcher Code „Startelf" bedeutet, muss man nicht wissen — es ist der, der
// genau elfmal vorkommt. Die Deckelung auf wenige verschiedene Werte hält
// IDs und Marktwerte draußen.
function alsStatus(werte) {
  const zaehler = new Map();
  for (const w of werte) {
    if (w == null || w === "") continue;
    const k = String(w);
    zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
  }
  if (zaehler.size === 0 || zaehler.size > 5) return null;

  const treffer = [...zaehler.entries()].filter(([, n]) => n === ELF);
  if (treffer.length !== 1) return null;

  const [wert] = treffer[0];
  return werte.map((w) => w != null && w !== "" && String(w) === wert);
}

const MUSTER = [
  { art: "Reihenfolge 1–11", pruefe: alsReihenfolge },
  { art: "Wahrheitswert", pruefe: alsWahrheit },
  { art: "Status-Code", pruefe: alsStatus },
];

// ── Die belegte Quelle: /v4/leagues/{id}/lineup ─────────────────────
//
// Der Endpunkt ist nachgewiesen (Diagnoseseite, 28.08.): Er liefert
// `{ it: [ { i, n, lo, st, lst, ... } ] }`, wobei `lo` die Position in der
// Aufstellung ist. Das schlägt jede Felderkennung — geraten wird nur noch,
// wenn er nicht antwortet.
//
// Für WEN er antwortet, steht nicht dabei. Das muss man auch nicht wissen:
// Die zurückgegebenen Spieler-IDs werden dem Manager zugeordnet, in dessen
// gespeichertem Kader sie stehen. Wer die Spieler hat, hat die Aufstellung.
export const LINEUP_PFADE = (leagueId, uid) => [
  ...(uid
    ? [
        `/v4/leagues/${leagueId}/lineup?uid=${uid}`,
        `/v4/leagues/${leagueId}/managers/${uid}/lineup`,
      ]
    : []),
  `/v4/leagues/${leagueId}/lineup`,
];

// Aus der Antwort die Spieler-IDs der Startelf ziehen.
//
// Zwei Formen sind denkbar und beide werden bedient: Entweder stehen dort
// nur die elf Aufgestellten, oder der ganze Kader mit `lo` als Kennzeichen.
export function elfAus(antwort) {
  const liste = Array.isArray(antwort?.it)
    ? antwort.it
    : Array.isArray(antwort?.pl)
      ? antwort.pl
      : Array.isArray(antwort)
        ? antwort
        : null;
  if (!liste || liste.length === 0) return null;

  const mitId = liste
    .map((s) => ({ id: String(s?.i ?? s?.id ?? s?.pi ?? ""), lo: Number(s?.lo) }))
    .filter((s) => s.id);
  if (mitId.length === 0) return null;

  // Genau elf: dann ist die Liste selbst die Aufstellung.
  if (mitId.length === ELF) return new Set(mitId.map((s) => s.id));

  // Sonst zählt `lo` – Position 1..11 heißt aufgestellt.
  const aufgestellt = mitId.filter((s) => Number.isInteger(s.lo) && s.lo >= 1 && s.lo <= ELF);
  if (aufgestellt.length === 0) return null;
  return new Set(aufgestellt.map((s) => s.id));
}

// Gibt zurück, was gefunden wurde — und woran. Das „woran" ist nicht
// Beiwerk: Ohne die Angabe lässt sich ein Fehlgriff nicht nachvollziehen.
export function findeAufstellung(rohListe) {
  const liste = Array.isArray(rohListe) ? rohListe : [];
  if (liste.length === 0) return null;

  // Ein Kader mit höchstens elf Spielern spielt zwangsläufig komplett.
  if (liste.length <= ELF) {
    return { drin: liste.map(() => true), feld: null, art: "Kader hat höchstens elf Spieler" };
  }

  const felder = new Set();
  for (const r of liste) {
    for (const k of Object.keys(r ?? {})) felder.add(k);
  }
  const reihenfolge = [
    ...KANDIDATEN.filter((f) => felder.has(f)),
    ...[...felder].filter((f) => !KANDIDATEN.includes(f)),
  ].filter((f) => !GESPERRT.has(f.toLowerCase()));

  for (const f of reihenfolge) {
    const werte = liste.map((r) => r?.[f]);
    for (const m of MUSTER) {
      const drin = m.pruefe(werte);
      if (drin) return { drin, feld: f, art: m.art };
    }
  }
  return null;
}

// Für die Diagnoseseite: was fällt in welchem Feld auf? Zeigt auch die
// Felder, die knapp danebenliegen — daran erkennt man, ob die Erkennung
// nur eine Kleinigkeit übersieht.
export function felderAnalyse(rohListe) {
  const liste = Array.isArray(rohListe) ? rohListe : [];
  const felder = new Set();
  for (const r of liste) for (const k of Object.keys(r ?? {})) felder.add(k);

  return [...felder].map((f) => {
    const werte = liste.map((r) => r?.[f]);
    const verschieden = new Set(werte.map((w) => String(w)));
    const treffer = MUSTER.map((m) => (m.pruefe(werte) ? m.art : null)).filter(Boolean);
    return {
      feld: f,
      gesperrt: GESPERRT.has(f.toLowerCase()),
      verschieden: verschieden.size,
      beispiele: [...verschieden].slice(0, 6),
      treffer,
    };
  }).sort((a, b) => (b.treffer.length - a.treffer.length) || a.verschieden - b.verschieden);
}
