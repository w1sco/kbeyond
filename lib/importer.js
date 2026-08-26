import { sql } from "./db";

const BASE = "https://api.kickbase.com";
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function holeSeite(leagueId, token, start, max, versuch = 0) {
  const res = await fetch(
    `${BASE}/v4/leagues/${leagueId}/activitiesFeed?start=${start}&max=${max}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );

  if (res.status === 429 || res.status === 503) {
    if (versuch >= 4) throw new Error("Rate-Limit erreicht");
    await schlaf(1500 * Math.pow(2, versuch));
    return holeSeite(leagueId, token, start, max, versuch + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} bei start=${start}`);
  return res.json();
}

function parseEvent(leagueId, e) {
  const d = e.data ?? {};
  return {
    id: String(e.i),
    league_id: leagueId,
    type: e.t,
    dt: e.dt,
    buyer: d.byr ?? null,
    seller: d.slr ?? null,
    price: d.trp ?? null,
    player_id: d.pi ? String(d.pi) : null,
    player_name: d.pn ?? ([d.fn, d.ln].filter(Boolean).join(" ") || null),
    raw: JSON.stringify(d),
  };
}

// Alle Events einer Seite in EINEM Statement schreiben
async function speichereBlock(events) {
  if (events.length === 0) return;
  await sql`
    INSERT INTO events (id, league_id, type, dt, buyer, seller, price, player_id, player_name, raw)
    SELECT * FROM UNNEST(
      ${events.map((e) => e.id)}::text[],
      ${events.map((e) => e.league_id)}::text[],
      ${events.map((e) => e.type)}::int[],
      ${events.map((e) => e.dt)}::timestamptz[],
      ${events.map((e) => e.buyer)}::text[],
      ${events.map((e) => e.seller)}::text[],
      ${events.map((e) => e.price)}::bigint[],
      ${events.map((e) => e.player_id)}::text[],
      ${events.map((e) => e.player_name)}::text[],
      ${events.map((e) => e.raw)}::jsonb[]
    )
    ON CONFLICT (id) DO NOTHING`;
}

export async function importiere(leagueId, token, opt = {}) {
  const {
    proSeite = 100,
    vollstaendig = false,
    startAb = 0,
    zeitbudgetMs = 45000,
  } = opt;

  const beginn = Date.now();

  const bekannt = new Set(
    (await sql`SELECT id FROM events WHERE league_id = ${leagueId}`).map((r) => r.id)
  );

  let start = startAb;
  let neu = 0;
  let seiten = 0;
  let fertig = false;
  let gestoppt = null;

  while (true) {
    if (Date.now() - beginn > zeitbudgetMs) {
      gestoppt = "Zeitbudget erreicht – nochmal klicken zum Fortsetzen";
      break;
    }

    const daten = await holeSeite(leagueId, token, start, proSeite);
    const liste = daten.af ?? [];
    seiten++;

    if (liste.length === 0) {
      fertig = true;
      break;
    }

    const frisch = liste
      .map((e) => parseEvent(leagueId, e))
      .filter((e) => !bekannt.has(e.id));

    if (!vollstaendig && frisch.length === 0) {
      gestoppt = "bekannte Events erreicht";
      fertig = true;
      break;
    }

    await speichereBlock(frisch);
    for (const e of frisch) bekannt.add(e.id);
    neu += frisch.length;

    start += liste.length;
    await schlaf(250);
  }

  const gesamt = (
    await sql`SELECT COUNT(*)::int AS n FROM events WHERE league_id = ${leagueId}`
  )[0].n;

  return { neu, seiten, gesamt, fertig, gestoppt, naechsterStart: fertig ? 0 : start };
}
