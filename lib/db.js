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
      gesamt       INT
    )`;
}

export async function getSettings(leagueId) {
  await sql`
    INSERT INTO liga_settings (league_id) VALUES (${leagueId})
    ON CONFLICT (league_id) DO NOTHING`;
  const r = await sql`SELECT * FROM liga_settings WHERE league_id = ${leagueId}`;
  return r[0];
}

export async function logImport(leagueId, neu, gesamt) {
  await sql`
    INSERT INTO import_log (league_id, letzter_lauf, neue_events, gesamt)
    VALUES (${leagueId}, NOW(), ${neu}, ${gesamt})
    ON CONFLICT (league_id) DO UPDATE
      SET letzter_lauf = NOW(), neue_events = ${neu}, gesamt = ${gesamt}`;
}

export async function getImportStatus(leagueId) {
  const log = await sql`SELECT * FROM import_log WHERE league_id = ${leagueId}`;
  const neuestes = await sql`
    SELECT MAX(dt) AS dt FROM events WHERE league_id = ${leagueId}`;
  return {
    letzterLauf: log[0]?.letzter_lauf ?? null,
    neueEvents: log[0]?.neue_events ?? null,
    gesamt: log[0]?.gesamt ?? null,
    neuestesEvent: neuestes[0]?.dt ?? null,
  };
}
