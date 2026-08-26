import { sql } from "./db";

const BASE = "https://api.kickbase.com";
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function kbGet(pfad, token, versuch = 0) {
  const res = await fetch(`${BASE}${pfad}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 429 || res.status === 503) {
    if (versuch >= 4) throw new Error("Rate-Limit erreicht");
    await schlaf(1500 * Math.pow(2, versuch));
    return kbGet(pfad, token, versuch + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} bei ${pfad}`);
  return res.json();
}

export async function holeSpielerPool(token) {
  const tabelle = await kbGet("/v4/competitions/1/table", token);
  const teams = (tabelle.it ?? []).map((t) => t.tid);

  const pool = new Map();
  for (const tid of teams) {
    try {
      const daten = await kbGet(`/v4/competitions/1/teams/${tid}/teamprofile`, token);
      for (const s of daten.it ?? []) {
        pool.set(String(s.i), { id: String(s.i), name: s.n, tid });
      }
    } catch {
      // Team überspringen
    }
    await schlaf(250);
  }
  return [...pool.values()];
}

function historieZuTransfers(leagueId, spielerId, spielerName, historie, stichtag) {
  const stich = new Date(stichtag);
  const eintraege = (historie.it ?? [])
    .map((e) => ({
      dt: new Date(e.dt),
      preis: Number(e.trp ?? 0),
      kaeufer: e.unm ?? null,
      typ: e.t,
    }))
    .sort((a, b) => a.dt - b.dt);

  const transfers = [];

  for (let i = 0; i < eintraege.length; i++) {
    const e = eintraege[i];
    if (e.dt < stich) continue;
    if (e.typ === 4) continue;
    if (e.preis <= 0) continue;

    let verkaeufer = null;
    if (i > 0 && eintraege[i - 1].typ !== 4) {
      verkaeufer = eintraege[i - 1].kaeufer;
    }

    transfers.push({
      id: `rk_${leagueId}_${spielerId}_${e.dt.getTime()}`,
      league_id: leagueId,
      type: 15,
      dt: e.dt.toISOString(),
      buyer: e.kaeufer,
      seller: verkaeufer,
      price: e.preis,
      player_id: spielerId,
      player_name: spielerName,
      raw: JSON.stringify({
        byr: e.kaeufer,
        slr: verkaeufer,
        trp: e.preis,
        pi: spielerId,
        pn: spielerName,
        rekonstruiert: true,
      }),
    });
  }

  return transfers;
}

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

export async function rekonstruiere(leagueId, token, stichtag, opt = {}) {
  const { zeitbudgetMs = 45000, abIndex = 0 } = opt;
  const beginn = Date.now();

  const cache = await sql`SELECT daten FROM pool_cache WHERE id = 'bundesliga'`;
  let spieler;
  if (cache[0]?.daten?.spieler && Date.now() - new Date(cache[0].daten.stand) < 86_400_000) {
    spieler = cache[0].daten.spieler;
  } else {
    spieler = await holeSpielerPool(token);
    const inhalt = JSON.stringify({ stand: new Date(), spieler });
    await sql`
      INSERT INTO pool_cache (id, daten) VALUES ('bundesliga', ${inhalt}::jsonb)
      ON CONFLICT (id) DO UPDATE SET daten = ${inhalt}::jsonb`;
  }

  const vorhanden = new Set(
    (await sql`
      SELECT player_id, dt FROM events
      WHERE league_id = ${leagueId} AND type = 15 AND player_id IS NOT NULL`
    ).map((r) => `${r.player_id}|${new Date(r.dt).toISOString().slice(0, 16)}`)
  );

  let index = abIndex;
  let neu = 0;
  let uebersprungen = 0;
  let geprueft = 0;

  while (index < spieler.length) {
    if (Date.now() - beginn > zeitbudgetMs) break;

    const s = spieler[index];
    try {
      const hist = await kbGet(`/v4/leagues/${leagueId}/players/${s.id}/transferHistory`, token);
      const alle = historieZuTransfers(leagueId, s.id, s.name, hist, stichtag);

      const frisch = alle.filter((t) => {
        const key = `${t.player_id}|${new Date(t.dt).toISOString().slice(0, 16)}`;
        if (vorhanden.has(key)) { uebersprungen++; return false; }
        vorhanden.add(key);
        return true;
      });

      await speichereBlock(frisch);
      neu += frisch.length;
    } catch {
      // Spieler überspringen
    }

    geprueft++;
    index++;
    await schlaf(200);
  }

  return {
    neu,
    uebersprungen,
    geprueft,
    index,
    gesamt: spieler.length,
    fertig: index >= spieler.length,
  };
}
