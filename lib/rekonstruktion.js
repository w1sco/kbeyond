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

// Alle Spieler-IDs der Liga aus den 18 Vereinskadern
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
      // einzelnes Team überspringen
    }
    await schlaf(250);
  }
  return [...pool.values()];
}

// Transferhistorie eines Spielers ab Stichtag in Transfers umrechnen
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
    if (e.typ === 4) continue;        // Liga-Reset-Marker
    if (e.preis <= 0) continue;

    // Verkäufer = Käufer des vorherigen Eintrags
    let verkaeufer = null;
    for (let j = i - 1; j >= 0; j--) {
      if (eintraege[j].typ === 4) break;
      if (eintraege[j].kaeufer) { verkaeufer = eintraege[j].kaeufer; break; }
      break;
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
      raw: JSON.stringify({ byr: e.kaeufer, slr: verkaeufer, trp: e.preis, pi: spielerId, pn: spielerName, rekonstruiert: true }),
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

  // Pool cachen, damit er nicht bei jedem Durchlauf neu geholt wird
  let pool = await sql`SELECT daten FROM pool_cache WHERE id = 'bundesliga'`;
  let spieler;
  if (pool[0] && Date.now() - new Date(pool[0].daten.stand) < 86_400_000) {
    spieler = pool[0].daten.spieler;
  } else {
    spieler = await holeSpielerPool(token);
    await sql`
      INSERT INTO pool_cache (id, daten) VALUES ('bundesliga', ${JSON.stringify({ stand: new Date(), spieler })}::jsonb)
      ON CONFLICT (id) DO UPDATE SET daten = ${JSON.stringify({ stand: new Date(), spieler })}::jsonb`;
  }

  let index = abIndex;
  let neu = 0;
  let geprueft = 0;
  let fertig = false;

  while (index < spieler.length) {
    if (Date.now() - beginn > zeitbudgetMs) break;

    const s = spieler[index];
    try {
      const hist = await kbGet(`/v4/leagues/${leagueId}/players/${s.id}/transferHistory`, token);
      const transfers = historieZuTransfers(leagueId, s.id, s.name, hist, stichtag);
      await speichereBlock(transfers);
      neu += transfers.length;
    } catch {
      // Spieler ohne Historie überspringen
    }

    geprueft++;
    index++;
    await schlaf(200);
  }

  if (index >= spieler.length) fertig = true;

  return { neu, geprueft, index, gesamt: spieler.length, fertig };
}
