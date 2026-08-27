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

// Elf ist die Obergrenze. Wer seine Aufstellung nicht fertig gemacht hat,
// steht mit weniger da.
//
// Beim **Endpunkt** ist das unkritisch — er liefert die Aufstellung, da
// wird gelesen und nicht bewiesen. Bei der **Felderkennung** ist die Zahl
// dagegen der ganze Beweis: Je weiter man sie öffnet, desto eher passt ein
// beliebiges Feld zufällig. Deshalb hier eine Untergrenze. Eine
// Kickbase-Aufstellung mit weniger als sieben Spielern ist unrealistisch,
// und ein Fehlalarm wäre schlimmer als eine fehlende Anzeige.
const MINDESTENS = 7;

const plausibel = (n) => n >= MINDESTENS && n <= ELF;

// Bekannte Kandidaten zuerst. Danach wird jedes andere Feld probiert —
// der Name ist ja gerade unbekannt.
// Felder, die eine Position in der Aufstellung tragen könnten.
const ORDNUNGSFELDER = ["lo", "lineup_order", "lineupOrder", "lineupPosition", "lp"];

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
  // Kandidaten sind kleine, nicht-negative Zahlen. Ob bei 0 oder 1
  // angefangen wird, ist nicht belegt — der Anfang wird abgelesen.
  const klein = werte.map(zahl).map((n) => (n != null && n >= 0 && n <= ELF ? n : null));
  const vorhanden = klein.filter((n) => n != null);
  if (vorhanden.length === 0) return null;

  const start = Math.min(...vorhanden);
  if (start > 1) return null;

  const gesetzt = new Set(vorhanden);
  let laenge = 0;
  while (laenge < ELF && gesetzt.has(start + laenge)) laenge++;
  if (!plausibel(laenge)) return null;

  // Doppelte Positionen wären keine Aufstellung.
  const ende = start + laenge - 1;
  const inFolge = vorhanden.filter((n) => n >= start && n <= ende);
  if (inFolge.length !== laenge) return null;

  return klein.map((n) => n != null && n >= start && n <= ende);
}

// 2. Wahrheitswert: genau elf echte true.
function alsWahrheit(werte) {
  const drin = werte.map((w) => w === true);
  return plausibel(drin.filter(Boolean).length) ? drin : null;
}

// 3. Status-Code: wenige verschiedene Werte, einer davon genau elfmal.
//
// Welcher Code „Startelf" bedeutet, muss man nicht wissen — es ist der, der
// genau elfmal vorkommt. Die Deckelung auf wenige verschiedene Werte hält
// IDs und Marktwerte draußen.
function alsStatus(werte, liste) {
  const zaehler = new Map();
  for (const w of werte) {
    if (w == null || w === "") continue;
    const k = String(w);
    zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
  }
  if (zaehler.size < 2 || zaehler.size > 5) return null;

  const treffer = [...zaehler.entries()].filter(([, n]) => plausibel(n));
  if (treffer.length === 0) return null;

  let wert;
  if (treffer.length === 1) {
    [wert] = treffer[0];
  } else {
    // Mehrdeutig: Bei 18 Spielern fallen elf Aufgestellte und sieben auf
    // der Bank beide in den Bereich. Entschieden wird über ein
    // Positionsfeld — wer aufgestellt ist, hat die kleinste Position.
    // Gibt es keins, gewinnt die größere Gruppe: Eine Aufstellung ist in
    // aller Regel die Mehrheit eines Kaders.
    const posFeld = ORDNUNGSFELDER.find((f) =>
      (liste ?? []).some((r) => zahl(r?.[f]) != null)
    );

    if (posFeld) {
      const mit = (liste ?? [])
        .map((r, i) => ({ i, pos: zahl(r?.[posFeld]) }))
        .filter((x) => x.pos != null);
      const kleinste = mit.reduce((a, b) => (a.pos <= b.pos ? a : b));
      const gruppe = String(werte[kleinste.i]);
      if (treffer.some(([w]) => w === gruppe)) wert = gruppe;
    }

    if (wert == null) {
      const groesste = treffer.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (treffer.filter(([, n]) => n === groesste[1]).length !== 1) return null;
      [wert] = groesste;
    }
  }

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
// **Elf ist die Obergrenze, nicht die Regel.** Wer seine Aufstellung nicht
// fertig gemacht hat, steht mit zehn oder weniger da — eine Erkennung, die
// auf „genau elf" besteht, liefert dann gar nichts. Der Endpunkt ist die
// belegte Quelle; hier wird nicht bewiesen, sondern gelesen.
export function elfAus(antwort) {
  const liste = Array.isArray(antwort?.it)
    ? antwort.it
    : Array.isArray(antwort?.pl)
      ? antwort.pl
      : Array.isArray(antwort)
        ? antwort
        : null;
  if (!liste || liste.length === 0) return null;

  const spieler = liste
    .map((s) => ({
      id: String(s?.i ?? s?.id ?? s?.pi ?? ""),
      lo: Number.isInteger(Number(s?.lo)) ? Number(s.lo) : null,
      roh: s,
    }))
    .filter((s) => s.id);
  if (spieler.length === 0) return null;

  const passt = (ids) => ids.size >= 1 && ids.size <= ELF;
  const fertig = (ids, art) => (passt(ids) ? { ids, art, anzahl: ids.size } : null);

  // 1. Ein Statusfeld, das eine Gruppe von höchstens elf auszeichnet — und
  //    die übrigen ausdrücklich nicht. Zwei Gruppen müssen es sein, sonst
  //    zeichnet das Feld gar nichts aus.
  for (const feld of ["lst", "lineup_status", "st", "mdst"]) {
    const werte = spieler.map((s) => s.roh?.[feld]);
    if (werte.every((w) => w == null)) continue;

    const zaehler = new Map();
    for (const w of werte) {
      if (w == null) continue;
      zaehler.set(String(w), (zaehler.get(String(w)) ?? 0) + 1);
    }
    if (zaehler.size < 2 || zaehler.size > 5) continue;

    // Mehrere Gruppen können in den Bereich fallen: Bei 15 Spielern und
    // einer Zehner-Aufstellung sind auch die fünf auf der Bank „höchstens
    // elf". Entschieden wird dann über die Position: Wer aufgestellt ist,
    // hat die kleinste `lo`.
    const treffer = [...zaehler.entries()].filter(([, n]) => n >= 1 && n <= ELF);
    if (treffer.length === 0) continue;

    let wert;
    if (treffer.length === 1) {
      [wert] = treffer[0];
    } else {
      const mitLoWerten = spieler.filter((x) => x.lo != null);
      if (mitLoWerten.length === 0) continue;
      const kleinste = mitLoWerten.reduce((a, b) => (a.lo <= b.lo ? a : b));
      const gruppe = String(kleinste.roh?.[feld]);
      if (!treffer.some(([w]) => w === gruppe)) continue;
      wert = gruppe;
    }
    const ids = new Set(spieler.filter((s) => String(s.roh?.[feld]) === wert).map((s) => s.id));
    const r = fertig(ids, `${feld} = ${wert}`);
    if (r) return r;
  }

  // 2. Die Position `lo` — ohne den Zahlenbereich zu raten.
  //
  // Ob bei 0 oder bei 1 angefangen wird, ist nicht belegt. Fest auf 1..11
  // zu filtern hat einen Ersatzspieler hereingelassen und den mit `lo: 0`
  // verworfen — bei einer Aufstellung typischerweise der Torwart. Gezählt
  // wird deshalb die **lückenlose Folge ab dem kleinsten Wert**, höchstens
  // elf lang. Bricht sie vorher ab, sind eben nur so viele aufgestellt.
  const mitLo = spieler.filter((s) => s.lo != null);
  if (mitLo.length > 0) {
    const start = Math.min(...mitLo.map((s) => s.lo));
    const nachPos = new Map(mitLo.map((s) => [s.lo, s]));

    const folge = [];
    for (let pos = start; pos < start + ELF; pos++) {
      const s = nachPos.get(pos);
      if (!s) break;
      folge.push(s);
    }

    if (folge.length > 0) {
      const ids = new Set(folge.map((s) => s.id));
      const ende = start + folge.length - 1;
      const r = fertig(ids, `lo ${start}–${ende}`);
      if (r) return r;
    }
  }

  // 3. Enthält die Liste höchstens elf Einträge, ist sie selbst die
  //    Aufstellung.
  const alle = new Set(spieler.map((s) => s.id));
  return fertig(alle, `Liste enthält ${alle.size}`);
}

// Gibt zurück, was gefunden wurde — und woran. Das „woran" ist nicht
// Beiwerk: Ohne die Angabe lässt sich ein Fehlgriff nicht nachvollziehen.
export function findeAufstellung(rohListe) {
  const liste = Array.isArray(rohListe) ? rohListe : [];
  if (liste.length === 0) return null;

  // Ein Kader mit höchstens elf Spielern spielt zwangsläufig komplett.
  if (liste.length <= ELF) {
    return {
      drin: liste.map(() => true),
      feld: null,
      art: "Kader hat höchstens elf Spieler",
      anzahl: liste.length,
    };
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
      const drin = m.pruefe(werte, liste);
      if (drin) return { drin, feld: f, art: m.art, anzahl: drin.filter(Boolean).length };
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
    const treffer = MUSTER.map((m) => (m.pruefe(werte, liste) ? m.art : null)).filter(Boolean);
    return {
      feld: f,
      gesperrt: GESPERRT.has(f.toLowerCase()),
      verschieden: verschieden.size,
      beispiele: [...verschieden].slice(0, 6),
      treffer,
    };
  }).sort((a, b) => (b.treffer.length - a.treffer.length) || a.verschieden - b.verschieden);
}
