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

// Die nächsten `anzahl` noch nicht gewerteten Partien eines Vereins, aus
// seiner Sicht: gegen wen, zu Hause oder auswärts.
export const VORSCHAU = [1, 3, 5];

export function naechsteGegner(spiele, team, anzahl = 1) {
  return (spiele ?? [])
    .filter((s) => !s.gewertet && (s.heim === team || s.gast === team))
    .sort((a, b) => (a.spieltag ?? 99) - (b.spieltag ?? 99)
      || String(a.datum ?? "").localeCompare(String(b.datum ?? "")))
    .slice(0, anzahl)
    .map((s) => ({
      gegner: s.heim === team ? s.gast : s.heim,
      heim: s.heim === team,
      spieltag: s.spieltag,
      datum: s.datum ?? null,
    }));
}

// Die nächste noch nicht gewertete Partie eines Vereins.
export function naechsterGegner(spiele, team) {
  return naechsteGegner(spiele, team, 1)[0] ?? null;
}

// Das Programm: Wie leicht sind die nächsten Gegner eines Vereins?
//
// Für jeden Verein die nächsten `anzahl` Gegner, und für jeden Gegner, wie
// viele Punkte er je Spiel auf der gewählten Position zulässt (aus
// werteMatchupsAus()). Der Schnitt darüber sagt, welcher Verein das
// leichteste Programm vor sich hat — dessen Spieler sind die Kandidaten.
//
// **Ein Schnitt nur, wenn jeder dieser Gegner bekannt ist.** Die frühere
// Gegner-Seite rechnete bei einem bekannten von fünf Gegnern einen
// „gewichteten Schnitt“, der schlicht dessen Wert war — gleich, ob er am
// nächsten oder fünften Spieltag kam. Fehlt ein Gegner, steht „2 von 3
// bekannt“ und kein Rang.
//
// Hat ein Verein weniger kommende Partien als verlangt (Saisonende), zählt,
// was es gibt — und die Zahl steht daneben.
//
// **Mit eigener Stärke** (`mitEigener`): Leichte Gegner allein reichen
// nicht, die eigene Mannschaft muss auch punkten. Dann zählt je Partie
//
//     Erwartung = eigene Punkte je Spiel + zugelassene des Gegners − Ligaschnitt
//
// Beides als Abweichung vom Ligaschnitt, auf den Ligaschnitt aufgesetzt: Ein
// Verein, der 10 über dem Schnitt punktet, gegen einen Gegner, der 5 über dem
// Schnitt zulässt, landet 15 über dem Schnitt. Das Ergebnis ist wieder in
// Punkten und ehrlich lesbar. Addiert statt multipliziert, weil Punkte auf
// einer Position auch negativ sein können — ein Produkt zweier negativer
// Werte käme als starke Erwartung heraus.
//
// `zeilen`, `ligaschnitt`: aus werteMatchupsAus(); `position`: "alle" | TW | ABW | MF | ANG
export function programm({ spiele = [], zeilen = [], position = "alle", anzahl = 3,
  mitEigener = false, ligaschnitt = null }) {
  const jeVerein = new Map(zeilen.map((z) => [z.team, z]));
  const raus = [];

  const liga = ligaschnitt?.[position] ?? null;

  for (const z of zeilen) {
    const eigen = z.erzielt?.[position]?.wert ?? null;
    const gegner = naechsteGegner(spiele, z.team, anzahl).map((n) => {
      const g = jeVerein.get(n.gegner);
      const schnitt = g?.jePosition?.[position]?.wert ?? null;
      return {
        ...n,
        schnitt,
        erwartung: schnitt != null && eigen != null && liga != null ? eigen + schnitt - liga : null,
        wenig: Boolean(g?.wenig),
      };
    });
    const bekannt = gegner.filter((g) => g.schnitt != null);
    const vollstaendig = gegner.length > 0 && bekannt.length === gegner.length;
    const schnitt = vollstaendig ? bekannt.reduce((s, g) => s + g.schnitt, 0) / gegner.length : null;
    const erwartung = schnitt != null && eigen != null && liga != null ? eigen + schnitt - liga : null;
    raus.push({
      team: z.team,
      gegner,
      bekannt: bekannt.length,
      schnitt,
      eigen,
      erwartung,
      // Wonach gereiht wird — je nach Schalter.
      wert: mitEigener ? erwartung : schnitt,
      wenig: gegner.some((g) => g.wenig) ||
        (mitEigener && (z.spieleEigen ?? 0) > 0 && z.spieleEigen < MIN_SPIELE),
      rang: null,
    });
  }

  // Wer das leichteste Programm hat, ist 1. Gleicher Wert teilt den Rang.
  const mit = raus.filter((r) => r.wert != null).sort((a, b) => b.wert - a.wert);
  let rang = 0;
  let vorher = null;
  mit.forEach((r, i) => {
    if (vorher === null || Math.abs(r.wert - vorher) > 1e-9) rang = i + 1;
    r.rang = rang;
    vorher = r.wert;
  });

  return raus.sort((a, b) => {
    if (a.wert == null && b.wert == null) return b.bekannt - a.bekannt;
    if (a.wert == null) return 1;
    if (b.wert == null) return -1;
    return b.wert - a.wert;
  });
}

// Je Position: Summe der Punkte und Zahl der Einsätze.
function leer() {
  const o = { alle: { summe: 0, einsaetze: 0 } };
  for (const p of POSITIONEN) o[p] = { summe: 0, einsaetze: 0 };
  return o;
}

const ALLE_SCHLUESSEL = ["alle", ...POSITIONEN];

function addiere(ziel, quelle) {
  for (const k of ALLE_SCHLUESSEL) {
    ziel[k].summe += quelle[k].summe;
    ziel[k].einsaetze += quelle[k].einsaetze;
  }
}

// Worauf gemessen wird.
//
// **„spieler“ — je Einsatz.** Alle Punkte auf der Position durch alle
// Einsätze auf der Position, über den ganzen Zeitraum zusammengefasst. Das
// ist die Zahl, die ein Manager braucht: Er besitzt einen Verteidiger, nicht
// die Kette. Je Mannschaft gerechnet, sähe ein Verein abwehrschwach aus, nur
// weil seine Gegner mit Fünferkette angetreten sind — fünf Verteidiger in
// der Summe statt drei.
//
// **„mannschaft“ — je Spiel.** Die Summe der Position je Partie. Bleibt als
// Schalter, weil sie zeigt, wie viel insgesamt herauskommt.
export const MASSE = ["spieler", "mannschaft"];

function messe(t, spiele, mass) {
  const jeSpiel = spiele > 0 ? t.summe / spiele : null;
  const jeSpieler = t.einsaetze > 0 ? t.summe / t.einsaetze : null;
  return {
    summe: spiele > 0 ? t.summe : null,
    einsaetze: t.einsaetze,
    schnitt: jeSpiel,
    jeSpieler,
    wert: mass === "spieler" ? jeSpieler : jeSpiel,
  };
}

// Die Auswertung.
//
// `spiele`:      [{ mi, spieltag, heim, gast, gewertet }]
// `leistungen`:  [{ mi, team, position, punkte }] — team = Verein des
//                Spielers in diesem Spiel; jede Zeile ist ein Einsatz
// `vollstaendig`: Set aus `${mi}|${team}` — diese Seite ist komplett geladen
// `bereich`:     { von, bis } Spieltage, beide eingeschlossen
// `mass`:        "mannschaft" (je Spiel) oder "spieler" (je Einsatz)
//
// Ergebnis: je Verein, was er zulässt (`jePosition`) und was er selbst erzielt
// (`erzielt`), jeweils mit `wert` im gewählten Maß; dazu Rang je Position
// (1 = lässt am meisten zu) und der Ligaschnitt im selben Maß.
export function werteMatchupsAus({ spiele = [], leistungen = [], vollstaendig = new Set(),
  bereich = null, mass = "mannschaft" }) {
  const imBereich = (s) =>
    s.gewertet && bereich && s.spieltag != null &&
    s.spieltag >= bereich.von && s.spieltag <= bereich.bis;

  // Punkte und Einsätze je Partie und Verein, nach Position
  const jeSeite = new Map();
  let ohnePosition = 0;
  for (const l of leistungen) {
    const schl = `${l.mi}|${l.team}`;
    if (!jeSeite.has(schl)) jeSeite.set(schl, leer());
    const p = Number(l.punkte ?? 0);
    const seite = jeSeite.get(schl);
    seite.alle.summe += p;
    seite.alle.einsaetze++;
    if (POSITIONEN.includes(l.position)) {
      seite[l.position].summe += p;
      seite[l.position].einsaetze++;
    } else if (p !== 0) ohnePosition++;
  }

  const teams = new Set();
  for (const s of spiele) { teams.add(s.heim); teams.add(s.gast); }

  const zeilen = [];
  for (const team of teams) {
    const zugelassen = leer();
    const eigen = leer();
    let gezaehlt = 0;
    let eigenGezaehlt = 0;
    let offen = 0;

    for (const s of spiele) {
      if (!imBereich(s)) continue;
      if (s.heim !== team && s.gast !== team) continue;
      const gegner = s.heim === team ? s.gast : s.heim;

      // Was der Verein selbst erzielt hat — dieselbe Sicherung: nur, wenn
      // seine eigene Seite komplett geladen ist.
      if (vollstaendig.has(`${s.mi}|${team}`)) {
        eigenGezaehlt++;
        addiere(eigen, jeSeite.get(`${s.mi}|${team}`) ?? leer());
      }

      // Was er zugelassen hat: die Seite des GEGNERS.
      if (!vollstaendig.has(`${s.mi}|${gegner}`)) { offen++; continue; }
      gezaehlt++;
      addiere(zugelassen, jeSeite.get(`${s.mi}|${gegner}`) ?? leer());
    }

    const jePosition = {};
    const erzielt = {};
    for (const k of ALLE_SCHLUESSEL) {
      jePosition[k] = { ...messe(zugelassen[k], gezaehlt, mass), rang: null };
      erzielt[k] = messe(eigen[k], eigenGezaehlt, mass);
    }

    zeilen.push({
      team,
      spiele: gezaehlt,
      spieleEigen: eigenGezaehlt,
      offen,
      wenig: gezaehlt > 0 && gezaehlt < MIN_SPIELE,
      jePosition,
      erzielt,
      naechster: naechsterGegner(spiele, team),
    });
  }

  // Ränge je Position: wer am meisten zulässt, ist 1. Gleicher Wert teilt
  // den Rang. Ohne Wert kein Rang.
  for (const k of ALLE_SCHLUESSEL) {
    const mit = zeilen
      .filter((z) => z.jePosition[k].wert != null)
      .sort((a, b) => b.jePosition[k].wert - a.jePosition[k].wert);
    let rang = 0;
    let vorher = null;
    mit.forEach((z, i) => {
      const w = z.jePosition[k].wert;
      if (vorher === null || Math.abs(w - vorher) > 1e-9) rang = i + 1;
      z.jePosition[k].rang = rang;
      vorher = w;
    });
  }

  // Der Ligaschnitt je Position im gewählten Maß, über alle vollständig
  // geladenen eigenen Seiten. Er ist die Null-Linie, gegen die eigene Stärke
  // und Gegner gemessen werden (siehe programm()).
  const ligaschnitt = {};
  const seiten = zeilen.reduce((n, z) => n + z.spieleEigen, 0);
  for (const k of ALLE_SCHLUESSEL) {
    const summe = zeilen.reduce((n, z) => n + (z.erzielt[k].summe ?? 0), 0);
    const einsaetze = zeilen.reduce((n, z) => n + z.erzielt[k].einsaetze, 0);
    ligaschnitt[k] = mass === "spieler"
      ? (einsaetze > 0 ? summe / einsaetze : null)
      : (seiten > 0 ? summe / seiten : null);
  }

  return { zeilen, ohnePosition, ligaschnitt };
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

// Wann hat jeder Verein zuletzt eine Partie beendet? Nur, was vor `jetzt`
// zu Ende ist — ein laufendes Spiel zählt noch nicht.
export function letzteEnden(spiele = [], jetzt = Date.now()) {
  const enden = new Map();
  for (const s of spiele) {
    if (!s.gewertet) continue;
    const ende = spielende(s.datum);
    if (ende == null || ende > jetzt) continue;
    for (const team of [s.heim, s.gast]) {
      enden.set(team, Math.max(enden.get(team) ?? 0, ende));
    }
  }
  return enden;
}

// Wer muss (wieder) gefragt werden? Jeder, dessen Verein seit seiner
// letzten Abfrage eine Partie zu Ende gespielt hat. Nach einem Spieltag
// sind das alle, nach einem Freitagsspiel nur zwei Vereine.
export function werIstOffen({ spiele = [], kader = new Map(), geprueftAm = new Map(), jetzt = Date.now() }) {
  const letztesEnde = letzteEnden(spiele, jetzt);
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

// Wer von den Offenen braucht wirklich einen Aufruf?
//
// **Wessen Saisonpunkte sich nicht bewegt haben, hat nichts dazugeholt.**
// Ersatztorhüter, Jugendspieler, Verletzte — rund die Hälfte eines Kaders
// spielt an einem Spieltag gar nicht. Ihre Leistungsreihe zu holen, kostet
// einen Aufruf und bringt keine einzige Punktzahl. Wer genau 0 geholt hat,
// fehlt dann zwar als Zeile, trägt aber auch nichts zur Summe bei.
//
// Übersprungen wird nur, wenn alle drei Bedingungen halten:
//
//   1. **Das Feld ist für diesen Spieler belegt.** Bei seiner letzten
//      Abfrage passte die Summe seiner Spiele genau zu den Saisonpunkten aus
//      der Spielerliste (`tpPasst`). Nichts wird geraten — steht `tp` im
//      Vereinskader für etwas anderes, passt die Summe nie, und es wird
//      gefragt wie bisher.
//   2. **Die Spielerliste ist jünger als sein letztes Spiel.** Sonst stünden
//      dort noch die Punkte von vorher, und „unverändert“ hieße nur
//      „noch nicht nachgelesen“.
//   3. **Die Saisonpunkte sind dieselben wie damals.**
//
// `poolStand` in ms; `tpJetzt`, `tpDamals`: Map id → Zahl; `tpPasst`: Map
// id → bool; `teamVon`: Map id → Verein.
export function teileAuf({ offen = [], teamVon = new Map(), letztesEnde = new Map(),
  poolStand = null, tpJetzt = new Map(), tpDamals = new Map(), tpPasst = new Map() }) {
  const fragen = [];
  const ueberspringen = [];
  for (const id of offen) {
    const ende = letztesEnde.get(teamVon.get(id));
    const jetzt = tpJetzt.get(id);
    const ruhig =
      tpPasst.get(id) === true &&
      poolStand != null && ende != null && poolStand >= ende &&
      jetzt != null && jetzt === tpDamals.get(id);
    (ruhig ? ueberspringen : fragen).push(id);
  }
  return { fragen, ueberspringen };
}
