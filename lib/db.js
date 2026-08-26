import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.DATABASE_URL);

export async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id           TEXT PRIMARY KEY,
      league_id    TEXT NOT NULL,
      type         INT  NOT NULL,
      dt           TIMESTAMPTZ NOT NULL,
      buyer        TEXT,
      seller       TEXT,
      price        BIGINT,
      player_id    TEXT,
      player_name  TEXT,
      raw          JSONB
    )`;
  await sql`CREATE INDEX IF NOT EXISTS ev_liga ON events (league_id, dt DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS liga_settings (
      league_id    TEXT PRIMARY KEY,
      stichtag     TIMESTAMPTZ,
      startbudget  BIGINT DEFAULT 50000000,
      punkte_bonus BIGINT DEFAULT 10000,
      login_aktiv  BOOLEAN DEFAULT TRUE,
      login_start  DATE,
      notiz        TEXT
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS korrektur (
      league_id    TEXT NOT NULL,
      manager      TEXT NOT NULL,
      betrag       BIGINT DEFAULT 0,
      grund        TEXT,
      PRIMARY KEY (league_id, manager)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS import_log (
      league_id    TEXT PRIMARY KEY,
      letzter_lauf TIMESTAMPTZ,
      neue_events  INT,
      gesamt       INT,
      offset_pos   INT DEFAULT 0,
      komplett     BOOLEAN DEFAULT FALSE
    )`;
  await sql`ALTER TABLE import_log ADD COLUMN IF NOT EXISTS offset_pos INT DEFAULT 0`;
  await sql`ALTER TABLE import_log ADD COLUMN IF NOT EXISTS komplett BOOLEAN DEFAULT FALSE`;
  await sql`
    CREATE TABLE IF NOT EXISTS pool_cache (
      id     TEXT PRIMARY KEY,
      daten  JSONB
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS rekon_log (
      league_id  TEXT PRIMARY KEY,
      position   INT DEFAULT 0,
      fertig     BOOLEAN DEFAULT FALSE,
      letzter    TIMESTAMPTZ,
      gefunden   INT DEFAULT 0
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS teamwerte (
      league_id  TEXT NOT NULL,
      manager_id TEXT NOT NULL,
      teamwert   BIGINT DEFAULT 0,
      spieler    INT DEFAULT 0,
      stand      TIMESTAMPTZ,
      PRIMARY KEY (league_id, manager_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS kader (
      league_id   TEXT NOT NULL,
      manager_id  TEXT NOT NULL,
      player_id   TEXT NOT NULL,
      name        TEXT,
      position    TEXT,
      marktwert   BIGINT DEFAULT 0,
      kaufpreis   BIGINT,
      punkte      INT,
      stand       TIMESTAMPTZ,
      PRIMARY KEY (league_id, manager_id, player_id)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS kader_liga ON kader (league_id)`;
}

// Alle Kader einer Liga: einmal als Liste, einmal nach Manager gruppiert.
export async function getKader(leagueId) {
  const zeilen = await sql`
    SELECT manager_id, player_id, name, position, marktwert, kaufpreis, punkte, stand
    FROM kader WHERE league_id = ${leagueId}
    ORDER BY marktwert DESC`;

  const proManager = new Map();
  let stand = null;
  for (const z of zeilen) {
    if (!proManager.has(z.manager_id)) proManager.set(z.manager_id, []);
    proManager.get(z.manager_id).push({
      id: String(z.player_id),
      name: z.name,
      position: z.position,
      marktwert: Number(z.marktwert ?? 0),
      kaufpreis: z.kaufpreis == null ? null : Number(z.kaufpreis),
      punkte: z.punkte,
    });
    if (!stand || new Date(z.stand) > new Date(stand)) stand = z.stand;
  }

  return { zeilen, proManager, stand, besetzt: new Set(zeilen.map((z) => String(z.player_id))) };
}

export async function getSettings(leagueId) {
  await sql`
    INSERT INTO liga_settings (league_id) VALUES (${leagueId})
    ON CONFLICT (league_id) DO NOTHING`;
  const r = await sql`SELECT * FROM liga_settings WHERE league_id = ${leagueId}`;
  return r[0];
}

export async function logImport(leagueId, neu, gesamt, offsetPos, komplett) {
  await sql`
    INSERT INTO import_log (league_id, letzter_lauf, neue_events, gesamt, offset_pos, komplett)
    VALUES (${leagueId}, NOW(), ${neu}, ${gesamt}, ${offsetPos}, ${komplett})
    ON CONFLICT (league_id) DO UPDATE
      SET letzter_lauf = NOW(), neue_events = ${neu}, gesamt = ${gesamt},
          offset_pos = ${offsetPos}, komplett = ${komplett}`;
}

export async function getTeamwerte(leagueId) {
  const r = await sql`SELECT * FROM teamwerte WHERE league_id = ${leagueId}`;
  const map = new Map();
  let stand = null;
  for (const z of r) {
    map.set(String(z.manager_id), { teamwert: Number(z.teamwert), spieler: z.spieler });
    if (!stand || new Date(z.stand) > new Date(stand)) stand = z.stand;
  }
  return { map, stand };
}

export async function getImportStatus(leagueId) {
  const log = await sql`SELECT * FROM import_log WHERE league_id = ${leagueId}`;
  const ev = await sql`
    SELECT MAX(dt) AS dt, COUNT(*)::int AS n FROM events WHERE league_id = ${leagueId}`;
  const rekon = await sql`SELECT * FROM rekon_log WHERE league_id = ${leagueId}`;
  const rk = await sql`
    SELECT COUNT(*)::int AS n FROM events
    WHERE league_id = ${leagueId} AND raw->>'rekonstruiert' = 'true'`;
  const feedStart = await sql`
    SELECT MIN(dt) AS dt FROM events
    WHERE league_id = ${leagueId} AND id NOT LIKE 'rk%'`;
  const strafen = await sql`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM((raw->>'amt')::bigint), 0)::bigint AS summe
    FROM events
    WHERE league_id = ${leagueId} AND type = 29 AND raw ? 'amt'`;

  return {
    letzterLauf: log[0]?.letzter_lauf ?? null,
    gesamt: ev[0]?.n ?? 0,
    offsetPos: log[0]?.offset_pos ?? 0,
    komplett: log[0]?.komplett ?? false,
    neuestesEvent: ev[0]?.dt ?? null,
    rekonPosition: rekon[0]?.position ?? 0,
    rekonFertig: rekon[0]?.fertig ?? false,
    rekonGefunden: rk[0]?.n ?? 0,
    feedStart: feedStart[0]?.dt ?? null,
    strafenAnzahl: strafen[0]?.n ?? 0,
    strafenSumme: Number(strafen[0]?.summe ?? 0),
  };
}
