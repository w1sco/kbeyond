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

  // Verlauf des Teamwerts. Die Tabelle teamwerte kennt nur den aktuellen
  // Stand — für "um wie viel ist der Kader gestiegen" braucht es den
  // vorherigen. Geschrieben wird nur, wenn sich der Wert geändert hat:
  // zweimal Aktualisieren hintereinander soll den Trend nicht auf 0 setzen.
  await sql`
    CREATE TABLE IF NOT EXISTS teamwert_verlauf (
      league_id  TEXT NOT NULL,
      manager_id TEXT NOT NULL,
      teamwert   BIGINT NOT NULL,
      stand      TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (league_id, manager_id, stand)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS tw_verlauf ON teamwert_verlauf (league_id, manager_id, stand DESC)`;

  // Wer stand wann auf dem Transfermarkt. Der Live-Markt ist nur im Moment
  // des Abrufs sichtbar; ohne Mitschrift wäre jedes Angebot, das der Feed
  // nicht mehr hergibt, für immer weg. Ein Angebot wird über seinen Ablauf
  // identifiziert — mehrmals aktualisieren legt es deshalb nicht mehrfach ab.
  await sql`
    CREATE TABLE IF NOT EXISTS markt_beobachtung (
      league_id  TEXT NOT NULL,
      player_id  TEXT NOT NULL,
      ablauf     TIMESTAMPTZ NOT NULL,
      gesehen    TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (league_id, player_id, ablauf)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS mb_liga ON markt_beobachtung (league_id, player_id)`;
  await sql`ALTER TABLE markt_beobachtung ADD COLUMN IF NOT EXISTS marktwert BIGINT`;

  // Marktwert-Historie je Spieler. Ligaunabhängig — Marktwerte gelten bei
  // Kickbase global. Damit lässt sich der Aufschlag auch für Käufe rechnen,
  // deren Angebot längst aus dem Feed-Fenster gefallen ist.
  await sql`
    CREATE TABLE IF NOT EXISTS marktwert_verlauf (
      player_id  TEXT NOT NULL,
      tag        DATE NOT NULL,
      marktwert  BIGINT NOT NULL,
      PRIMARY KEY (player_id, tag)
    )`;

  // Wen wir schon gefragt haben. Ohne das würde jeder Lauf dieselben
  // Spieler ohne Historie erneut abfragen.
  await sql`
    CREATE TABLE IF NOT EXISTS marktwert_geprueft (
      player_id  TEXT PRIMARY KEY,
      geprueft   TIMESTAMPTZ,
      gefunden   INT DEFAULT 0
    )`;

  // Einstellungen und Korrekturen gehören dem einzelnen Nutzer, nicht der
  // Liga. Vorher teilten sich alle Mitglieder einer Liga eine Zeile — wer
  // etwas änderte, änderte es allen. Die Altbestände behalten user_id = '',
  // sie dienen neuen Nutzern als Vorlage.
  await sql`ALTER TABLE liga_settings ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE liga_settings DROP CONSTRAINT IF EXISTS liga_settings_pkey`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ls_liga_nutzer ON liga_settings (league_id, user_id)`;

  await sql`ALTER TABLE korrektur ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE korrektur DROP CONSTRAINT IF EXISTS korrektur_pkey`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS korr_liga_nutzer ON korrektur (league_id, user_id, manager)`;
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

// Einstellungen des Nutzers in dieser Liga. Beim ersten Zugriff wird von der
// Liga-Vorlage geerbt (der Zeile ohne Nutzer, also dem Bestand von vor der
// Trennung) — sonst stünde jeder Neuzugang vor leeren Feldern und müsste
// Stichtag und Korrekturen von Hand nachtragen. Ab dann ist die eigene Zeile
// unabhängig: Änderungen wirken auf niemanden sonst.
// Wem gehört welcher Spieler — abgeleitet aus den Transfers, ohne einen
// einzigen API-Aufruf. Der letzte Transfer eines Spielers entscheidet: hat er
// einen Käufer, gehört der Spieler dem; steht dort nur ein Verkäufer, ging er
// zurück an Kickbase und ist frei.
//
// Das ist die verlässlichere Quelle als der Kaderabruf: sie funktioniert auch,
// wenn Kickbase die Kaderliste in einem Format liefert, das wir nicht kennen.
export async function getBesitz(leagueId) {
  const zeilen = await sql`
    SELECT DISTINCT ON (player_id) player_id, buyer, seller, dt
    FROM events
    WHERE league_id = ${leagueId} AND type = 15 AND player_id IS NOT NULL
    ORDER BY player_id, dt DESC`;

  const besitzer = new Map();
  for (const z of zeilen) {
    if (z.buyer) besitzer.set(String(z.player_id), z.buyer);
  }
  return { besitzer, gehandelt: zeilen.length };
}

export async function getSettings(leagueId, nutzer = "") {
  const schluessel = nutzer ?? "";

  const eigene = await sql`
    SELECT * FROM liga_settings WHERE league_id = ${leagueId} AND user_id = ${schluessel}`;
  if (eigene[0]) return eigene[0];

  const vorlage = (await sql`
    SELECT * FROM liga_settings WHERE league_id = ${leagueId} AND user_id = ''`)[0] ?? null;

  await sql`
    INSERT INTO liga_settings (league_id, user_id, stichtag, startbudget, punkte_bonus, login_aktiv, login_start, notiz)
    VALUES (${leagueId}, ${schluessel},
            ${vorlage?.stichtag ?? null},
            ${vorlage?.startbudget ?? 50000000},
            ${vorlage?.punkte_bonus ?? 10000},
            ${vorlage?.login_aktiv ?? true},
            ${vorlage?.login_start ?? null},
            ${vorlage?.notiz ?? null})
    ON CONFLICT (league_id, user_id) DO NOTHING`;

  // Korrekturen der Vorlage einmalig mitnehmen
  if (schluessel !== "") {
    await sql`
      INSERT INTO korrektur (league_id, user_id, manager, betrag, grund)
      SELECT league_id, ${schluessel}, manager, betrag, grund
      FROM korrektur WHERE league_id = ${leagueId} AND user_id = ''
      ON CONFLICT (league_id, user_id, manager) DO NOTHING`;
  }

  const neu = await sql`
    SELECT * FROM liga_settings WHERE league_id = ${leagueId} AND user_id = ${schluessel}`;
  return neu[0];
}

export async function getKorrekturen(leagueId, nutzer = "") {
  const zeilen = await sql`
    SELECT manager, betrag FROM korrektur
    WHERE league_id = ${leagueId} AND user_id = ${nutzer ?? ""}`;
  return new Map(zeilen.map((r) => [r.manager, Number(r.betrag)]));
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

// Der vollständige Verlauf für das Diagramm.
export async function getTeamwertVerlauf(leagueId, ab) {
  return await sql`
    SELECT manager_id, teamwert, stand FROM teamwert_verlauf
    WHERE league_id = ${leagueId} AND stand >= ${ab}
    ORDER BY manager_id, stand`;
}

// Veränderung des Teamwerts gegenüber dem vorherigen gespeicherten Stand.
export async function getTeamwertTrend(leagueId) {
  const zeilen = await sql`
    SELECT manager_id, teamwert, stand, vorher, stand_vorher FROM (
      SELECT manager_id, teamwert, stand,
             LAG(teamwert) OVER (PARTITION BY manager_id ORDER BY stand) AS vorher,
             LAG(stand)    OVER (PARTITION BY manager_id ORDER BY stand) AS stand_vorher,
             ROW_NUMBER()  OVER (PARTITION BY manager_id ORDER BY stand DESC) AS platz
      FROM teamwert_verlauf
      WHERE league_id = ${leagueId}
    ) x WHERE platz = 1 AND vorher IS NOT NULL`;

  const map = new Map();
  for (const z of zeilen) {
    map.set(String(z.manager_id), {
      trend: Number(z.teamwert) - Number(z.vorher),
      vorher: Number(z.vorher),
      standVorher: z.stand_vorher,
    });
  }
  return map;
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
