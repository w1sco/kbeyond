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
}

export async function getSettings(leagueId) {
  await sql`
    INSERT INTO liga_settings (league_id) VALUES (${leagueId})
    ON CONFLICT (league_id) DO NOTHING`;
  const r = await sql`SELECT * FROM liga_settings WHERE league_id = ${leagueId}`;
  return r[0];
}
