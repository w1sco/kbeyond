import { kbFetch } from "./kickbase";
import { sql, speichereChancen, naechsterSpieltag } from "./db";
import { normalisiereSpieler } from "./format";
import { ernte } from "./startelf.js";

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Marktwert und Position stehen im teamprofile nicht garantiert unter
// festen Namen – normalisiereSpieler probiert die bekannten Varianten durch.
function poolEintrag(roh, teamId, verein = null) {
  const s = normalisiereSpieler(roh);
  return {
    id: String(roh.i ?? s.id),
    name: s.name,
    position: s.position,
    marktwert: s.marktwert == null ? null : Number(s.marktwert),
    teamId: String(teamId),
    verein,
    quelle: "kader",
  };
}

// Der Vereinsname – unter welchem Feld er in der Tabelle steht, ist nicht
// belegt. Deshalb die bekannten Kandidaten durchprobieren statt raten, und
// im Zweifel lieber nichts als eine Zahl: Eine Team-ID als "Verein" ist für
// eine Nachrichtensuche schlimmer als gar keine Angabe.
function vereinsname(eintrag) {
  for (const k of ["tn", "n", "name", "teamName", "cn"]) {
    const w = eintrag?.[k];
    if (typeof w === "string" && w.trim() && !/^\d+$/.test(w.trim())) return w.trim();
  }
  return null;
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

// Der Spielerpool: alle Bundesliga-Spieler, wie wir sie kennen.
//
// ── Nur lesen, nie bauen ────────────────────────────────────────────
//
// Ein Aufbau kostet 19 Anfragen. Der lief früher beim Seitenaufruf los,
// sobald der Cache 24 Stunden alt war — mitten im Rendern der Marktseite,
// völlig außerhalb der Bremse. Gebaut wird jetzt ausschließlich im
// Aktualisieren-Lauf; Seiten lesen nur.
export async function holePool() {
  const cache = await sql`SELECT daten FROM pool_cache WHERE id = 'bundesliga_v2'`;
  const daten = cache[0]?.daten;
  return {
    spieler: daten?.spieler ?? [],
    stand: daten?.stand ?? null,
    leer: !daten?.spieler?.length,
  };
}

// ── Ergänzen, nicht ersetzen ────────────────────────────────────────
//
// Neuzugänge kommen laufend dazu, Spieler wechseln den Verein, Marktwerte
// ändern sich. Der Pool wird deshalb täglich durchgegangen und
// zusammengeführt: Neue kommen dazu, Bekannte werden aktualisiert.
//
// Zusammenführen statt Überschreiben hat einen zweiten Vorteil: Scheitert
// ein Vereinsabruf oder reicht die Zeit nicht, verschwinden dessen Spieler
// nicht — der Lauf macht beim nächsten Mal einfach weiter. Der Stand wird
// nur fortgeschrieben, wenn wirklich alle Vereine dran waren.
export async function aktualisierePool(token, opt = {}) {
  const { frist = Date.now() + 20_000 } = opt;

  const alt = await holePool();
  const nachId = new Map(alt.spieler.map((s) => [String(s.id), s]));

  const tabelle = await kbFetch("/v4/competitions/1/table", token);
  const eintraege = tabelle.it ?? [];
  const teams = eintraege.map((t) => t.tid);
  const namen = new Map(eintraege.map((t) => [String(t.tid), vereinsname(t)]));

  let neu = 0;
  let geaendert = 0;
  let geschafft = 0;
  const zugaenge = [];

  // Trägt der Vereinskader die Startelf-Chance mit, ist sie hier umsonst
  // zu haben — 18 Aufrufe, die ohnehin laufen, statt einem je Spieler.
  // Trägt er sie nicht, bleibt die Liste leer und es ändert sich nichts.
  const chancen = [];

  for (const tid of teams) {
    if (Date.now() > frist) break;
    try {
      const daten = await kbFetch(`/v4/competitions/1/teams/${tid}/teamprofile`, token);
      chancen.push(...ernte(daten.it ?? []));
      for (const roh of daten.it ?? []) {
        const e = poolEintrag(roh, tid, namen.get(String(tid)) ?? null);
        if (!e.id) continue;

        const vorher = nachId.get(e.id);
        if (!vorher) {
          nachId.set(e.id, e);
          neu++;
          if (zugaenge.length < 5) zugaenge.push(e.name);
        } else if (
          vorher.marktwert !== e.marktwert ||
          String(vorher.teamId) !== String(e.teamId) ||
          vorher.name !== e.name ||
          (e.verein && vorher.verein !== e.verein)
        ) {
          nachId.set(e.id, { ...vorher, ...e });
          geaendert++;
        }
      }
      geschafft++;
    } catch (e) {
      if (e.gedrosselt) throw e;
      // Verein überspringen – seine Spieler bleiben aus dem alten Stand erhalten
    }
  }

  if (chancen.length > 0) {
    await speichereChancen(chancen, await naechsterSpieltag());
  }

  const vollstaendig = geschafft === teams.length && teams.length > 0;
  const stand = vollstaendig ? new Date() : alt.stand;

  const inhalt = JSON.stringify({ stand, spieler: [...nachId.values()] });
  await sql`
    INSERT INTO pool_cache (id, daten) VALUES ('bundesliga_v2', ${inhalt}::jsonb)
    ON CONFLICT (id) DO UPDATE SET daten = ${inhalt}::jsonb`;

  return {
    neu, geaendert, zugaenge,
    vereine: geschafft, gesamt: teams.length,
    vollstaendig,
    spieler: nachId.size,
    chancen: chancen.length,
  };
}

export async function rekonstruiere(leagueId, token, stichtag, opt = {}) {
  const { zeitbudgetMs = 45000, abIndex = 0 } = opt;
  const beginn = Date.now();

  // Kader-Pool (gecached, 24h)
  // Nur lesen – gebaut wird der Pool im Aktualisieren-Lauf davor.
  const { spieler: kaderPool } = await holePool();

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
