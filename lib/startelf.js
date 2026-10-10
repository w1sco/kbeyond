// Wie wahrscheinlich steht ein Spieler am Wochenende in der Startelf?
//
// Kickbase zeigt das als eines von fünf Zeichen und liefert es im
// Spielerprofil als Feld `prob` (Quelle laut Antwort: Ligainsider,
// mitgeliefert in `plpt`).
//
// Reine Rechnung, keine Datenbank — wie gebot.js und loginbonus.js, damit
// sie sich ohne Postgres durchrechnen lässt.

// Die fünf Stufen in der Reihenfolge, in der Kickbase sie zeigt.
// `wert` ist der Wert aus `prob`.
export const STUFEN = [
  { wert: 1, zeichen: "★", kurz: "Stamm",     name: "Sicher in der Startelf",              klasse: "kb-elf--sicher" },
  { wert: 2, zeichen: "✔", kurz: "sehr wahrscheinlich", name: "Sehr wahrscheinlich Stamm", klasse: "kb-elf--wahrscheinlich" },
  { wert: 3, zeichen: "?", kurz: "fraglich",  name: "Vielleicht Stamm",                     klasse: "kb-elf--fraglich" },
  { wert: 4, zeichen: "!", kurz: "unwahrscheinlich", name: "Eher nicht, kleine Chance",     klasse: "kb-elf--kaum" },
  { wert: 5, zeichen: "✕", kurz: "spielt nicht", name: "Keine Chance auf die Startelf",     klasse: "kb-elf--nie" },
];

export function stufe(wert) {
  const n = Number(wert);
  if (!Number.isInteger(n)) return null;
  return STUFEN.find((s) => s.wert === n) ?? null;
}

// Aus einer rohen Spielerantwort die Stufe lesen.
//
// **Nur das Feld `prob`.** Ein zweiter Kandidat wäre hier gefährlich: Im
// selben Objekt stehen `pos` (1–4), `mvt` (2) und `st` — alles kleine
// Zahlen, die zufällig passen würden. Eine falsche Startelf-Angabe ist
// schlimmer als gar keine, denn danach stellt jemand auf.
export function leseChance(roh) {
  if (!roh || typeof roh !== "object") return null;
  const n = Number(roh.prob);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

// Aus einer rohen Liste (Vereinskader, Marktangebote, Kader eines Managers)
// alles einsammeln, was eine Chance mitführt.
//
// **Das ist der billige Weg.** Diese Listen holen wir ohnehin — trägt
// Kickbase `prob` darin mit, kostet die ganze Angabe keinen einzigen
// zusätzlichen Aufruf. Trägt sie es nicht, kommt hier eine leere Liste
// zurück und der teure Weg über die Einzelprofile bleibt.
export function ernte(rohListe) {
  const raus = [];
  for (const roh of rohListe ?? []) {
    const id = roh?.pi ?? roh?.i ?? roh?.id;
    const stufe = leseChance(roh);
    if (id != null && stufe != null) raus.push({ id: String(id), stufe });
  }
  return raus;
}

// Für die Aufstellung: Wer trägt die Elf? Absteigend nach Sicherheit,
// Unbekannte hinten — sie sind keine Absage, nur eine Lücke.
export function chanceRang(wert) {
  const s = stufe(wert);
  return s ? s.wert : 99;
}

// Ein Kader in Zahlen: wie viele je Stufe, und wie viele ohne Angabe.
export function verteilung(werte) {
  const zaehler = new Map(STUFEN.map((s) => [s.wert, 0]));
  let ohne = 0;
  for (const w of werte ?? []) {
    const s = stufe(w);
    if (s) zaehler.set(s.wert, zaehler.get(s.wert) + 1);
    else ohne++;
  }
  return { jeStufe: zaehler, ohne, gesamt: (werte ?? []).length };
}

// ── Gruppen für den Filter ──────────────────────────────────────────
//
// Fünf Gruppen, **überschneidungsfrei** — nur so ergibt eine Mehrfachauswahl
// einen Sinn. „Spielt sicher" und „spielt evtl." zusammen sind dann genau
// die, die man aufstellen kann. Wer keine Angabe hat, ist eine eigene
// Gruppe: weder sicher noch vielleicht, aber auch nicht „spielt nicht".
//
// Hier statt in der Marktliste, weil Markt- und Matchup-Seite denselben
// Filter tragen.
export const ELF_GRUPPEN = [
  { schluessel: "sicher", label: "★ ✔ spielt sicher", passt: (st) => st === 1 || st === 2 },
  { schluessel: "evtl",   label: "? spielt evtl.",    passt: (st) => st === 3 },
  { schluessel: "kaum",   label: "! eher nicht",      passt: (st) => st === 4 },
  { schluessel: "nie",    label: "✕ spielt nicht",    passt: (st) => st === 5 },
  { schluessel: "offen",  label: "ohne Angabe",       passt: (st) => st == null },
];
// Die Abkürzung für „alle raus, die definitiv nicht spielen".
export const OHNE_NIE = ELF_GRUPPEN.map((g) => g.schluessel).filter((s) => s !== "nie");
