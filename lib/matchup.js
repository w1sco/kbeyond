// Matchups: Wie viele Punkte lässt ein Verein zu — je Position?
//
// Die Frage dahinter: Gegen wen hat mein Stürmer am Wochenende leichtes
// Spiel? Gezählt wird, was die **Gegner** eines Vereins in dessen Spielen
// geholt haben, getrennt nach Position. Wer viele Punkte zulässt, ist ein
// gutes Matchup für die, die als Nächstes gegen ihn spielen.
//
// Reine Rechnung, keine Datenbank — wie gebot.js und elfstaerke.js.
//
// Drei Sicherungen aus der früheren Gegner-Seite, die einmal 202 gegen 23
// bei einer einzigen gewerteten Partie ausgewiesen hat:
//
//   1. **Nur vollständig geladene Seiten zählen.** Während die Leistungen in
//      Bündeln hereinkommen, ist die Summe eines Vereins zu niedrig — und
//      das sähe aus wie ein starker Gegner, nicht wie eine Datenlücke. Eine
//      Partie, deren Angreiferseite noch nicht komplett ist, bleibt draußen
//      und wird als „offen“ gezählt.
//   2. **Nur gewertete Partien.** Vor dem Anpfiff wäre alles 0.
//   3. **Die Stichprobe steht daneben.** Ein Schnitt aus einem Spiel ist
//      ein Spiel. Er wird gezeigt, aber mit seiner Zahl Spiele — und unter
//      MIN_SPIELE als „wenig Daten“ markiert.

import { POS_ORDNUNG } from "./format.js";

export const POSITIONEN = POS_ORDNUNG; // TW, ABW, MF, ANG
export const MIN_SPIELE = 3;
export const ZEITRAEUME = [
  { schluessel: "3", label: "letzte 3", spieltage: 3 },
  { schluessel: "5", label: "letzte 5", spieltage: 5 },
  { schluessel: "alle", label: "ganze Saison", spieltage: null },
];

// Der Spieltagsbereich für „letzte n“: gezählt ab dem jüngsten Spieltag,
// an dem überhaupt gespielt wurde.
export function bereichFuer(spiele, spieltage) {
  const gewertet = (spiele ?? []).filter((s) => s.gewertet && s.spieltag != null);
  if (gewertet.length === 0) return null;
  const bis = Math.max(...gewertet.map((s) => s.spieltag));
  const von = spieltage == null ? 1 : Math.max(1, bis - spieltage + 1);
  return { von, bis };
}

// Die nächste noch nicht gewertete Partie eines Vereins.
export function naechsterGegner(spiele, team) {
  const kommend = (spiele ?? [])
    .filter((s) => !s.gewertet && (s.heim === team || s.gast === team))
    .sort((a, b) => (a.spieltag ?? 99) - (b.spieltag ?? 99));
  const s = kommend[0];
  if (!s) return null;
  return {
    gegner: s.heim === team ? s.gast : s.heim,
    heim: s.heim === team,
    spieltag: s.spieltag,
    datum: s.datum ?? null,
  };
}

function leer() {
  const o = { alle: { summe: 0 } };
  for (const p of POSITIONEN) o[p] = { summe: 0 };
  return o;
}

// Die Auswertung.
//
// `spiele`:      [{ mi, spieltag, heim, gast, gewertet }]
// `leistungen`:  [{ mi, team, position, punkte }] — team = Verein des
//                Spielers in diesem Spiel
// `vollstaendig`: Set aus `${mi}|${team}` — diese Seite ist komplett geladen
// `bereich`:     { von, bis } Spieltage, beide eingeschlossen
//
// Ergebnis: je Verein die zugelassenen Punkte je Position (Summe und
// Schnitt je Spiel), die Zahl gezählter und offener Partien, der nächste
// Gegner — und je Position ein Rang (1 = lässt am meisten zu).
export function werteMatchupsAus({ spiele = [], leistungen = [], vollstaendig = new Set(), bereich = null }) {
  const imBereich = (s) =>
    s.gewertet && bereich && s.spieltag != null &&
    s.spieltag >= bereich.von && s.spieltag <= bereich.bis;

  // Punkte je Partie und Verein, nach Position
  const jeSeite = new Map();
  let ohnePosition = 0;
  for (const l of leistungen) {
    const schl = `${l.mi}|${l.team}`;
    if (!jeSeite.has(schl)) jeSeite.set(schl, leer());
    const p = Number(l.punkte ?? 0);
    const summen = jeSeite.get(schl);
    summen.alle.summe += p;
    if (POSITIONEN.includes(l.position)) summen[l.position].summe += p;
    else if (p !== 0) ohnePosition++;
  }

  const teams = new Set();
  for (const s of spiele) { teams.add(s.heim); teams.add(s.gast); }

  const zeilen = [];
  for (const team of teams) {
    const summe = leer();
    let gezaehlt = 0;
    let offen = 0;

    for (const s of spiele) {
      if (!imBereich(s)) continue;
      if (s.heim !== team && s.gast !== team) continue;
      const gegner = s.heim === team ? s.gast : s.heim;
      // Die Seite, deren Punkte zählen, ist die des GEGNERS.
      if (!vollstaendig.has(`${s.mi}|${gegner}`)) { offen++; continue; }
      gezaehlt++;
      const g = jeSeite.get(`${s.mi}|${gegner}`) ?? leer();
      for (const k of ["alle", ...POSITIONEN]) summe[k].summe += g[k].summe;
    }

    const jePosition = {};
    for (const k of ["alle", ...POSITIONEN]) {
      jePosition[k] = {
        summe: gezaehlt > 0 ? summe[k].summe : null,
        schnitt: gezaehlt > 0 ? summe[k].summe / gezaehlt : null,
        rang: null,
      };
    }

    zeilen.push({
      team,
      spiele: gezaehlt,
      offen,
      wenig: gezaehlt > 0 && gezaehlt < MIN_SPIELE,
      jePosition,
      naechster: naechsterGegner(spiele, team),
    });
  }

  // Ränge je Position: wer am meisten zulässt, ist 1. Gleicher Schnitt
  // teilt den Rang. Ohne gezähltes Spiel kein Rang.
  for (const k of ["alle", ...POSITIONEN]) {
    const mit = zeilen
      .filter((z) => z.jePosition[k].schnitt != null)
      .sort((a, b) => b.jePosition[k].schnitt - a.jePosition[k].schnitt);
    let rang = 0;
    let vorher = null;
    mit.forEach((z, i) => {
      const w = z.jePosition[k].schnitt;
      if (vorher === null || Math.abs(w - vorher) > 1e-9) rang = i + 1;
      z.jePosition[k].rang = rang;
      vorher = w;
    });
  }

  return { zeilen, ohnePosition };
}

// Wann eine Partie sicher vorbei ist: Anstoß plus drei Stunden.
export const SPIELENDE_H = 3;
export function spielende(datum) {
  const t = Date.parse(datum ?? "");
  return Number.isFinite(t) ? t + SPIELENDE_H * 3600_000 : null;
}

// Welche Seiten einer Partie vollständig geladen sind.
//
// Eine Seite (Partie + Verein) ist komplett, wenn **jeder Spieler, der
// heute für diesen Verein im Pool steht**, nach dem Ende dieser Partie
// abgefragt wurde. Wer den Verein inzwischen verlassen hat, steht mit
// seinen alten Zeilen ohnehin schon in der Datenbank; wer neu dazukam, hat
// für die alten Partien seinen alten Verein in `pt`.
//
// **An der Uhrzeit, nicht an der Spieltagsnummer.** Ein Spieltag läuft von
// Freitag bis Sonntag. Wer am Samstag abruft, hat die Sonntagspartie noch
// nicht — mit der Nummer als Merker stünde sie trotzdem als erledigt da,
// und ihre Punkte kämen nie herein.
//
// `kader`: Map team → [player_id]; `geprueftAm`: Map player_id → ms.
export function vollstaendigeSeiten({ spiele = [], kader = new Map(), geprueftAm = new Map() }) {
  const set = new Set();
  for (const s of spiele) {
    if (!s.gewertet) continue;
    const ende = spielende(s.datum);
    if (ende == null) continue;
    for (const team of [s.heim, s.gast]) {
      const ids = kader.get(team) ?? [];
      if (ids.length === 0) continue; // ohne Kader kein Beleg
      if (ids.every((id) => (geprueftAm.get(id) ?? 0) >= ende)) {
        set.add(`${s.mi}|${team}`);
      }
    }
  }
  return set;
}

// Wer muss (wieder) gefragt werden? Jeder, dessen Verein seit seiner
// letzten Abfrage eine Partie zu Ende gespielt hat. Nach einem Spieltag
// sind das alle, nach einem Freitagsspiel nur zwei Vereine.
export function werIstOffen({ spiele = [], kader = new Map(), geprueftAm = new Map(), jetzt = Date.now() }) {
  const letztesEnde = new Map();
  for (const s of spiele) {
    if (!s.gewertet) continue;
    const ende = spielende(s.datum);
    if (ende == null || ende > jetzt) continue;
    for (const team of [s.heim, s.gast]) {
      letztesEnde.set(team, Math.max(letztesEnde.get(team) ?? 0, ende));
    }
  }
  const offen = [];
  for (const [team, ids] of kader) {
    const ende = letztesEnde.get(team);
    if (ende == null) continue;
    for (const id of ids) {
      if ((geprueftAm.get(id) ?? 0) < ende) offen.push(id);
    }
  }
  return offen;
}
