import { sql } from "./db.js";
import { kbFetch } from "./kickbase.js";
import { leseSpielplan } from "./spielplan.js";

// Der Spielplan, und nur der.
//
// Hier stand einmal auch die **Leistungsreihe je Spieler** — ein Aufruf
// je Spieler, rund 470 in der Bundesliga, nach jedem Spieltag erneut. Sie
// trug allein die Gegner-Seite; mit der ist sie mit rausgeflogen. Der
// Spielplan bleibt: An ihm hängt, für welchen Spieltag die
// Startelf-Prognose gilt.

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
