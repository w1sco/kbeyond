// Mit Endung, damit der Prüfstand die Datei ohne Next laufen lassen kann:
// ein blanker Node-Lauf löst "./format" nicht auf.
import { fuerTag, ausEingabe } from "./format.js";

// Tagesreihen aus dem Teamwert-Verlauf.
//
// Gespeichert wird nur, wenn sich ein Wert ändert — und zu der Uhrzeit, zu
// der jemand aktualisiert hat. Für ein Diagramm taugt das nicht: jeder
// Manager hätte seine eigenen Stützstellen und die Linien wären nicht
// vergleichbar.
//
// Deshalb ein festes Raster: **0:00 Uhr deutscher Zeit** für jeden Tag. Der
// Wert eines Tages ist der letzte bekannte Stand davor. Solange ein Manager
// noch keinen Stand hat, bleibt seine Linie leer statt bei null zu liegen —
// null wäre eine Aussage, "unbekannt" ist die Wahrheit.

const TAG_MS = 86_400_000;

// Mitternacht deutscher Zeit für den Kalendertag eines Zeitpunkts.
function mitternacht(d) {
  return ausEingabe(`${fuerTag(d)}T00:00`);
}

export function tagesraster(von, bis) {
  const start = mitternacht(von);
  const ende = mitternacht(bis);
  const tage = [];
  for (let t = start.getTime(); t <= ende.getTime(); ) {
    const d = new Date(t);
    tage.push(d);
    // Über die Zeitumstellung hinweg neu bestimmen: ein Tag hat dort 23
    // oder 25 Stunden, stures Addieren von 24 h würde verrutschen.
    const naechster = mitternacht(new Date(t + TAG_MS * 1.5));
    if (naechster.getTime() <= t) break;
    t = naechster.getTime();
  }
  return tage;
}

// zeilen: [{ manager_id, teamwert, stand }]
export function tagesreihen(zeilen, tage) {
  const proManager = new Map();
  for (const z of zeilen) {
    const id = String(z.manager_id);
    if (!proManager.has(id)) proManager.set(id, []);
    proManager.get(id).push({ stand: new Date(z.stand), wert: Number(z.teamwert) });
  }

  const reihen = new Map();
  for (const [id, punkte] of proManager) {
    punkte.sort((a, b) => a.stand - b.stand);

    const werte = [];
    let i = 0;
    let letzter = null;
    for (const tag of tage) {
      while (i < punkte.length && punkte[i].stand <= tag) {
        letzter = punkte[i].wert;
        i++;
      }
      werte.push(letzter);
    }
    reihen.set(id, werte);
  }
  return reihen;
}

// Alle Kalendertage von `von` bis `bis`, jeweils als YYYY-MM-DD.
export function tageZwischen(von, bis) {
  const raus = [];
  const a = Date.parse(`${fuerTag(von)}T00:00:00Z`);
  const b = Date.parse(`${fuerTag(bis)}T00:00:00Z`);
  if (isNaN(a) || isNaN(b) || b < a) return raus;
  // Ein Jahr ist die Obergrenze – schützt vor einem unsinnigen Stichtag,
  // der sonst Hunderttausende Tage erzeugen würde.
  for (let t = a, n = 0; t <= b && n < 400; t += 86_400_000, n++) {
    raus.push(new Date(t).toISOString().slice(0, 10));
  }
  return raus;
}

// Marktwert eines Spielers an einem Tag: der Wert des Tages, sonst der
// letzte davor. Ohne Wert kommt `null` zurück — dann fehlt der Spieler in
// der Summe, und das muss die Anzeige wissen.
export function wertAmTag(reihe, tag) {
  if (!reihe?.length) return null;
  let letzter = null;
  for (const [t, w] of reihe) {
    if (t > tag) break;
    letzter = w;
  }
  return letzter;
}

