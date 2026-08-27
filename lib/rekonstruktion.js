import { kbFetch } from "./kickbase";
import { sql } from "./db";
import { normalisiereSpieler } from "./format";

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Marktwert und Position stehen im teamprofile nicht garantiert unter
// festen Namen – normalisiereSpieler probiert die bekannten Varianten durch.
function poolEintrag(roh, teamId) {
  const s = normalisiereSpieler(roh);
  return {
    id: String(roh.i ?? s.id),
    name: s.name,
    position: s.position,
    marktwert: s.marktwert == null ? null : Number(s.marktwert),
    teamId: String(teamId),
    quelle: "kader",
  };
}

export async function holeSpielerPool(token) {
  const tabelle = await kbFetch("/v4/competitions/1/table", token);
  const teams = (tabelle.it ?? []).map((t) => t.tid);

  const pool = new Map();
  const fehlgeschlagen = [];

  for (const tid of teams) {
    try {
      const daten = await kbFetch(`/v4/competitions/1/teams/${tid}/teamprofile`, token);
      for (const s of daten.it ?? []) {
        pool.set(String(s.i), poolEintrag(s, tid));
      }
    } catch {
      fehlgeschlagen.push(tid);
    }
    await schlaf(250);
  }

  // Zweiter Versuch für Teams, die beim ersten Durchlauf gescheitert sind
  for (const tid of fehlgeschlagen) {
    try {
      const daten = await kbFetch(`/v4/competitions/1/teams/${tid}/teamprofile`, token);
      for (const s of daten.it ?? []) {
        pool.set(String(s.i), poolEintrag(s, tid));
      }
    } catch {
      // endgültig überspringen
    }
    await schlaf(400);
  }

  return [...pool.values()];
}

// Spieler, die in dieser Liga schon mal gehandelt wurden – auch wenn sie
// heute in keinem Bundesliga-Kader mehr stehen.
async function holeBekannteSpieler(leagueId) {
  const r = await sql`
    SELECT DISTINCT player_id AS id,
           MAX(player_name) AS name
    FROM events
    WHERE league_id = ${leagueId} AND player_id IS NOT NULL
    GROUP BY player_id`;
  return r.map((x) => ({ id: String(x.id), name: x.name ?? "?", quelle: "event" }));
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

// Der Pool aller Bundesliga-Spieler, 24 h gecached. Ein voller Aufbau kostet
// 18 Requests — den will weder die Rekonstruktion noch die Marktseite bei
// jedem Aufruf zahlen.
export async function holePoolGecached(token) {
  const cache = await sql`SELECT daten FROM pool_cache WHERE id = 'bundesliga_v2'`;
  if (cache[0]?.daten?.spieler && Date.now() - new Date(cache[0].daten.stand) < 86_400_000) {
    return { spieler: cache[0].daten.spieler, stand: cache[0].daten.stand, frisch: false };
  }

  const spieler = await holeSpielerPool(token);
  const stand = new Date();
  const inhalt = JSON.stringify({ stand, spieler });
  await sql`
    INSERT INTO pool_cache (id, daten) VALUES ('bundesliga_v2', ${inhalt}::jsonb)
    ON CONFLICT (id) DO UPDATE SET daten = ${inhalt}::jsonb`;
  return { spieler, stand, frisch: true };
}

export async function rekonstruiere(leagueId, token, stichtag, opt = {}) {
  const { zeitbudgetMs = 45000, abIndex = 0 } = opt;
  const beginn = Date.now();

  // Kader-Pool (gecached, 24h)
  const { spieler: kaderPool } = await holePoolGecached(token);

  // Zusätzlich alle je in dieser Liga gehandelten Spieler
  const ausEvents = await holeBekannteSpieler(leagueId);

  const zusammen = new Map();
  for (const s of kaderPool) zusammen.set(String(s.id), s);
  for (const s of ausEvents) if (!zusammen.has(s.id)) zusammen.set(s.id, s);
  const spieler = [...zusammen.values()];

  const ausKader = spieler.filter((s) => s.quelle === "kader").length;
  const nurEvents = spieler.length - ausKader;

  // Grenze: ältester echter Feed-Eintrag – alles ab da gehört dem Feed
  const grenzeRow = await sql`
    SELECT MIN(dt) AS aeltestes FROM events
    WHERE league_id = ${leagueId} AND id NOT LIKE 'rk%'`;
  const grenze = grenzeRow[0]?.aeltestes ? new Date(grenzeRow[0].aeltestes) : null;

  let index = abIndex;
  let neu = 0;
  let geprueft = 0;

  while (index < spieler.length) {
    if (Date.now() - beginn > zeitbudgetMs) break;

    const s = spieler[index];
    try {
      const hist = await kbFetch(`/v4/leagues/${leagueId}/players/${s.id}/transferHistory`, token);
      const alle = historieZuTransfers(leagueId, s.id, s.name, hist, stichtag);
      const frisch = grenze ? alle.filter((t) => new Date(t.dt) < grenze) : alle;
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
    geprueft,
    index,
    gesamt: spieler.length,
    ausKader,
    nurEvents,
    grenze: grenze ? grenze.toISOString() : null,
    fertig: index >= spieler.length,
  };
}
