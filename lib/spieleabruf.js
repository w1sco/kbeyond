import { sql } from "./db.js";
import { kbFetch } from "./kickbase.js";
import { holePool } from "./rekonstruktion.js";
import { leseSpielplan, leseLeistungen } from "./spielplan.js";

// Wie viele Spieler ein Lauf höchstens nach ihrer Leistungsreihe fragt.
//
// **Das ist der teuerste Posten im Projekt**: ein Aufruf je Spieler, und
// die Bundesliga hat rund 470. Deshalb in Häppchen, mit Gedächtnis, und
// mit einem Zeitbudget davor — genau wie die Rekonstruktion.
//
// Bei 25 je Klick ist die Liga nach etwa zwanzig Klicks vollständig; nach
// einem Spieltag läuft dasselbe noch einmal, weil jeder Spieler eine neue
// Zeile bekommen hat.
const SPIELER_JE_LAUF = 25;
const ZEITBUDGET_MS = 25_000;

// ── Der Spielplan: ein Aufruf für die ganze Saison ──────────────────
//
// `/v4/competitions/1/matchdays` liefert alle 34 Spieltage auf einmal.
// Das ist so billig, dass es in jedem Lauf mitgemacht wird — Ergebnisse
// und Ansetzungen sind damit immer aktuell.
export async function importiereSpielplan(token) {
  const daten = await kbFetch("/v4/competitions/1/matchdays", token);
  const spiele = leseSpielplan(daten);
  if (spiele.length === 0) return { spiele: 0, gewertet: 0 };

  await sql`
    INSERT INTO spiele (spieltag, heim, gast, datum, mi, tore_heim, tore_gast, stand)
    SELECT * FROM UNNEST(
      ${spiele.map((s) => s.spieltag)}::int[],
      ${spiele.map((s) => s.heim)}::text[],
      ${spiele.map((s) => s.gast)}::text[],
      ${spiele.map((s) => s.datum)}::timestamptz[],
      ${spiele.map((s) => s.mi)}::text[],
      ${spiele.map((s) => s.toreHeim)}::int[],
      ${spiele.map((s) => s.toreGast)}::int[]
    ) AS t(spieltag, heim, gast, datum, mi, tore_heim, tore_gast),
      NOW()
    ON CONFLICT (spieltag, heim, gast) DO UPDATE SET
      datum = EXCLUDED.datum,
      mi = EXCLUDED.mi,
      tore_heim = EXCLUDED.tore_heim,
      tore_gast = EXCLUDED.tore_gast,
      stand = NOW()`;

  return {
    spiele: spiele.length,
    gewertet: spiele.filter((s) => s.gewertet).length,
  };
}

// Der jüngste Spieltag, der wirklich gewertet ist.
async function letzterGewerteterTag() {
  const r = await sql`
    SELECT MAX(spieltag) AS tag FROM spiele
    WHERE tore_heim IS NOT NULL AND tore_gast IS NOT NULL`;
  return r[0]?.tag == null ? 0 : Number(r[0].tag);
}

// ── Die Einzelleistungen: ein Aufruf je Spieler, in Häppchen ────────
//
// Wer bis zum aktuellen Spieltag abgeholt ist, wird übersprungen. Nach
// einem neuen Spieltag steht die ganze Liga wieder an — dann arbeitet
// sich der Aktualisieren-Knopf über mehrere Klicks durch.
export async function importiereLeistungen(token, { max = SPIELER_JE_LAUF } = {}) {
  const bisTag = await letzterGewerteterTag();
  if (bisTag === 0) return { geholt: 0, offen: 0, hinweis: "noch kein gewerteter Spieltag" };

  const pool = await holePool();
  const alle = (pool.spieler ?? []).map((s) => String(s.id)).filter(Boolean);
  if (alle.length === 0) return { geholt: 0, offen: 0, hinweis: "Spielerliste noch nicht geladen" };

  const fertig = await sql`
    SELECT player_id FROM leistung_geprueft WHERE bis_tag >= ${bisTag}`;
  const schonDa = new Set(fertig.map((z) => z.player_id));
  const offen = alle.filter((id) => !schonDa.has(id));
  if (offen.length === 0) return { geholt: 0, offen: 0 };

  const start = Date.now();
  let geholt = 0;
  let zeilen = 0;

  for (const pid of offen.slice(0, max)) {
    if (Date.now() - start > ZEITBUDGET_MS) break;

    let leistungen;
    try {
      const daten = await kbFetch(`/v4/competitions/1/players/${pid}/performance`, token);
      leistungen = leseLeistungen(daten);
    } catch (e) {
      // Ein Spieler ohne Reihe reißt den Lauf nicht mit — er wird nur
      // nicht als erledigt vermerkt und kommt beim nächsten Klick dran.
      if (e?.status === 404) {
        await sql`
          INSERT INTO leistung_geprueft (player_id, bis_tag, geprueft)
          VALUES (${pid}, ${bisTag}, NOW())
          ON CONFLICT (player_id) DO UPDATE
            SET bis_tag = ${bisTag}, geprueft = NOW()`;
      }
      continue;
    }

    if (leistungen.length > 0) {
      await sql`
        INSERT INTO spieler_punkte (player_id, mi, team_id, spieltag, punkte)
        SELECT * FROM UNNEST(
          ${leistungen.map(() => pid)}::text[],
          ${leistungen.map((l) => l.mi)}::text[],
          ${leistungen.map((l) => l.team)}::text[],
          ${leistungen.map((l) => l.spieltag)}::int[],
          ${leistungen.map((l) => l.punkte)}::int[]
        ) AS t(player_id, mi, team_id, spieltag, punkte)
        ON CONFLICT (player_id, mi) DO UPDATE SET
          team_id = EXCLUDED.team_id,
          spieltag = EXCLUDED.spieltag,
          punkte = EXCLUDED.punkte`;
      zeilen += leistungen.length;
    }

    await sql`
      INSERT INTO leistung_geprueft (player_id, bis_tag, geprueft)
      VALUES (${pid}, ${bisTag}, NOW())
      ON CONFLICT (player_id) DO UPDATE
        SET bis_tag = ${bisTag}, geprueft = NOW()`;
    geholt++;
  }

  return { geholt, zeilen, offen: offen.length - geholt, bisTag };
}
