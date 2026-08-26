import { sql } from "./db";

const BASE = "https://api.kickbase.com";
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function holeSeite(leagueId, token, start, max, versuch = 0) {
  const res = await fetch(
    `${BASE}/v4/leagues/${leagueId}/activitiesFeed?start=${start}&max=${max}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );

  if (res.status === 429 || res.status === 503) {
    if (versuch >= 5) throw new Error("Rate-Limit: zu viele Versuche");
    const warte = 2000 * Math.pow(2, versuch);
    await schlaf(warte);
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
    player_name: d.pn ?? [d.fn, d.ln].filter(Boolean).join(" ") || null,
    raw: JSON.stringify(d),
  };
}

export async function importiere(leagueId, token, { maxSeiten = 40, proSeite = 100, vollstaendig = false } = {}) {
  const bekannt = new Set(
    (await sql`SELECT id FROM events WHERE league_id = ${leagueId}`).map((r) => r.id)
  );

  let start = 0, neu = 0, seiten = 0, fertig = false, gestoppt = null;

  while (seiten < maxSeiten) {
    const daten = await holeSeite(leagueId, token, start, proSeite);
    const liste = daten.af ?? [];
    seiten++;

    if (liste.length === 0) { fertig = true; break; }

    const frisch = liste.map((e) => parseEvent(leagueId, e)).filter((e) => !bekannt.has(e.id));

    // Inkrementell: sobald nur noch Bekanntes kommt, aufhören
    if (!vollstaendig && frisch.length === 0) { gestoppt = "bekannte Events erreicht"; fertig = true; break; }

    for (const e of frisch) {
      await sql`
        INSERT INTO events (id, league_id, type, dt, buyer, seller, price, player_id, player_name, raw)
        VALUES (${e.id}, ${e.league_id}, ${e.type}, ${e.dt}, ${e.buyer}, ${e.seller},
                ${e.price}, ${e.player_id}, ${e.player_name}, ${e.raw}::jsonb)
        ON CONFLICT (id) DO NOTHING`;
      bekannt.add(e.id);
      neu++;
    }

    start += liste.length;
    await schlaf(350); // Schonfrist für die API
  }

  const gesamt = (await sql`SELECT COUNT(*)::int AS n FROM events WHERE league_id = ${leagueId}`)[0].n;
  return { neu, seiten, gesamt, fertig, gestoppt, naechsterStart: start };
}
