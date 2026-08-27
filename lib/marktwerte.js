import { sql } from "./db";

// Marktwert eines Spielers zu einem bestimmten Tag.
//
// Gebraucht für den Aufschlag: Kaufpreis minus Marktwert *zum Kaufzeitpunkt*.
// Bisher kam diese Bezugsgröße nur aus dem Feed-Event "Spieler neu am Markt"
// und aus der eigenen Mitschrift — beides fehlt für Käufe, deren Angebot aus
// dem Feed-Fenster gefallen ist. Genau die blieben in der Auswertung außen
// vor: ein Manager mit 11 Spielern erschien mit 7 Käufen.
//
// Kickbase führt zu jedem Spieler eine Marktwert-Historie. Welcher Endpunkt
// sie liefert und unter welchen Feldnamen, ist im Projekt nicht belegt —
// deshalb werden mehrere Kandidaten durchprobiert und die Antwort defensiv
// ausgewertet, statt einen Feldnamen zu raten.

const BASE = "https://api.kickbase.com";
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

const KANDIDATEN = (lid, pid) => [
  `/v4/leagues/${lid}/players/${pid}/marketValue`,
  `/v4/leagues/${lid}/players/${pid}/marketvalue`,
  `/v4/leagues/${lid}/players/${pid}/mv`,
  `/v4/leagues/${lid}/players/${pid}`,
];

const DATUMSFELDER = ["dt", "d", "day", "date", "t"];
const WERTFELDER = ["mv", "m", "v", "value", "marketValue"];

function alsDatum(wert) {
  if (wert == null) return null;
  // Zahlen können Sekunden, Millisekunden oder ein Tagesindex sein — nur
  // Werte übernehmen, die als Zeitpunkt plausibel sind.
  if (typeof wert === "number") {
    const ms = wert > 1e11 ? wert : wert * 1000;
    const d = new Date(ms);
    return d.getFullYear() > 2015 && d.getFullYear() < 2100 ? d : null;
  }
  const d = new Date(wert);
  return isNaN(d) || d.getFullYear() < 2015 ? null : d;
}

function alsPunkt(eintrag) {
  if (!eintrag || typeof eintrag !== "object") return null;
  let tag = null;
  for (const k of DATUMSFELDER) {
    tag = alsDatum(eintrag[k]);
    if (tag) break;
  }
  if (!tag) return null;

  for (const k of WERTFELDER) {
    const w = Number(eintrag[k]);
    if (Number.isFinite(w) && w > 0) return { tag, marktwert: Math.round(w) };
  }
  return null;
}

// Sucht in der ganzen Antwort die längste Reihe aus Datum und Wert.
export function findeWertreihe(daten, tiefe = 0) {
  if (!daten || typeof daten !== "object" || tiefe > 6) return [];

  let beste = [];
  const pruefe = (kandidat) => {
    if (kandidat.length > beste.length) beste = kandidat;
  };

  if (Array.isArray(daten)) {
    pruefe(daten.map(alsPunkt).filter(Boolean));
    for (const x of daten) pruefe(findeWertreihe(x, tiefe + 1));
    return beste;
  }

  for (const x of Object.values(daten)) pruefe(findeWertreihe(x, tiefe + 1));
  return beste;
}

async function hole(pfad, token) {
  const res = await fetch(`${BASE}${pfad}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Holt die Historie eines Spielers und legt sie ab. Ein Tag, ein Wert.
export async function ladeMarktwertVerlauf(leagueId, playerId, token) {
  let reihe = [];
  let benutzterPfad = null;

  for (const pfad of KANDIDATEN(leagueId, playerId)) {
    try {
      const gefunden = findeWertreihe(await hole(pfad, token));
      if (gefunden.length > reihe.length) {
        reihe = gefunden;
        benutzterPfad = pfad;
      }
      // Eine brauchbare Reihe reicht – die übrigen Kandidaten sparen wir uns
      if (reihe.length > 5) break;
    } catch {
      // Kandidat gibt es nicht, nächster
    }
  }

  if (reihe.length === 0) {
    await sql`
      INSERT INTO marktwert_geprueft (player_id, geprueft, gefunden)
      VALUES (${String(playerId)}, NOW(), 0)
      ON CONFLICT (player_id) DO UPDATE SET geprueft = NOW(), gefunden = 0`;
    return { punkte: 0, pfad: null };
  }

  await sql`
    INSERT INTO marktwert_verlauf (player_id, tag, marktwert)
    SELECT ${String(playerId)}::text, *, * FROM UNNEST(
      ${reihe.map((p) => p.tag.toISOString().slice(0, 10))}::date[],
      ${reihe.map((p) => p.marktwert)}::bigint[]
    ) AS t(tag, marktwert)
    ON CONFLICT (player_id, tag) DO UPDATE SET marktwert = EXCLUDED.marktwert`;

  await sql`
    INSERT INTO marktwert_geprueft (player_id, geprueft, gefunden)
    VALUES (${String(playerId)}, NOW(), ${reihe.length})
    ON CONFLICT (player_id) DO UPDATE SET geprueft = NOW(), gefunden = ${reihe.length}`;

  return { punkte: reihe.length, pfad: benutzterPfad };
}

// Für welche Käufe fehlt der Marktwert noch? Genau die brauchen eine Historie.
export async function spielerOhneMarktwert(leagueId, stichtag, grenze = 25) {
  const zeilen = await sql`
    SELECT DISTINCT k.player_id
    FROM events k
    WHERE k.league_id = ${leagueId} AND k.type = 15 AND k.buyer IS NOT NULL
      AND k.dt >= ${stichtag} AND k.player_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM marktwert_verlauf v
        WHERE v.player_id = k.player_id AND v.tag = k.dt::date
      )
      AND NOT EXISTS (
        SELECT 1 FROM marktwert_geprueft g
        WHERE g.player_id = k.player_id
          AND g.gefunden = 0 AND g.geprueft > NOW() - interval '7 days'
      )
    LIMIT ${grenze}`;
  return zeilen.map((z) => String(z.player_id));
}

// Holt fehlende Historien, bis das Zeitbudget aufgebraucht ist.
export async function ergaenzeMarktwerte(leagueId, token, opt = {}) {
  const { frist = Date.now() + 20_000, stichtag } = opt;

  const offen = await spielerOhneMarktwert(leagueId, stichtag);
  let geholt = 0;
  let ohneHistorie = 0;

  for (const pid of offen) {
    if (Date.now() > frist) return { geholt, ohneHistorie, offen: offen.length, gestoppt: true };
    try {
      const e = await ladeMarktwertVerlauf(leagueId, pid, token);
      if (e.punkte > 0) geholt++;
      else ohneHistorie++;
    } catch {
      ohneHistorie++;
    }
    await schlaf(220);
  }

  return { geholt, ohneHistorie, offen: offen.length, gestoppt: false };
}
