import { neon } from "@neondatabase/serverless";
import { letztesMwUpdate } from "./format";

// In der Produktion spricht die App über HTTP mit Neon. Für den Prüfstand
// (siehe pruefstand/) läuft daneben ein gewöhnliches Postgres — das versteht
// den Neon-Treiber nicht, also wird dort auf den normalen pg-Treiber
// umgeschaltet.
//
// Der Grund für den Aufwand: Fehler in SQL oder in der Reihenfolge von
// Zuweisungen fallen beim Bauen nicht auf. Sie fallen erst auf, wenn die
// Seite wirklich läuft — bisher hieß das: beim Nutzer.
function verbinde() {
  const url = process.env.DATABASE_URL ?? "";
  const lokal = /@(localhost|127\.0\.0\.1|\/)/.test(url) || url.startsWith("postgres:///");

  if (!lokal) return neon(url);

  // Nur im Prüfstand: Tagged Template auf pg abbilden.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: url });

  return function tagged(teile, ...werte) {
    const text = teile.reduce(
      (acc, t, i) => acc + t + (i < werte.length ? `$${i + 1}` : ""),
      ""
    );
    return pool.query(text, werte).then((r) => r.rows);
  };
}

export const sql = verbinde();

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
      punkte_bonus BIGINT DEFAULT 1000,
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

  // Spielernachrichten. Archiv wie die Events: einmal geholt, bleibt es
  // stehen, bis es überschrieben wird. Ligagebunden, weil der Kader und
  // damit die Auswahl der Spieler an der Liga hängt.
  await sql`
    CREATE TABLE IF NOT EXISTS news (
      league_id  TEXT NOT NULL,
      player_id  TEXT NOT NULL,
      name       TEXT,
      text       TEXT,
      stimmung   TEXT,
      quellen    JSONB,
      stand      TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (league_id, player_id)
    )`;

  // Unsere eigene Mitschrift der Marktwerte, ein Eintrag je Spieler und
  // Marktwert-Tag (Grenze 22:04, siehe mwTag).
  //
  // Getrennt von marktwert_verlauf, obwohl die Form dieselbe ist: Dort
  // stehen Kalendertage aus Kickbases Historie, hier Marktwert-Tage aus
  // unseren eigenen Ablesungen. In einer Tabelle vermischt lägen die
  // Einträge um bis zu einen Tag versetzt und der Aufschlag griffe auf den
  // falschen Bezugswert.
  //
  // Ligaunabhängig – ein Marktwert gilt für alle Ligen gleich.
  await sql`
    CREATE TABLE IF NOT EXISTS mw_beobachtung (
      player_id  TEXT NOT NULL,
      tag        DATE NOT NULL,
      marktwert  BIGINT NOT NULL,
      PRIMARY KEY (player_id, tag)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS mw_beob_tag ON mw_beobachtung (tag DESC)`;

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
  // An welchem Wochentag das erste Spiel des Spieltags angepfiffen wird.
  // Bis dahin kommen noch Login-Boni dazu, mit denen die Rechner planen.
  // Der Punkte-Bonus war mit 10.000 € je Punkt angesetzt — eine Annahme aus
  // der Zeit, als die Saison noch nicht lief und überall 0 Punkte standen.
  // Belegt sind 1.000 €. Der alte Wert wird deshalb einmalig mitgezogen;
  // wer bewusst etwas anderes eingetragen hat, behält es.
  await sql`
    UPDATE liga_settings SET punkte_bonus = 1000
    WHERE punkte_bonus = 10000`;
  await sql`ALTER TABLE liga_settings ALTER COLUMN punkte_bonus SET DEFAULT 1000`;

  // Ein Stand je Manager und Kalendertag: Teamwert, berechneter Kontostand
  // und Punkte. Daraus entstehen die Platzierungspfeile ("zwei Plätze seit
  // gestern"). Der Teamwert-Verlauf allein reicht dafür nicht — er kennt den
  // Kontostand nicht, und genau der entscheidet über Gesamtwert und Rang.
  await sql`
    CREATE TABLE IF NOT EXISTS tagesstand (
      league_id  TEXT NOT NULL,
      manager_id TEXT NOT NULL,
      tag        DATE NOT NULL,
      teamwert   BIGINT,
      konto      BIGINT,
      punkte     INT,
      PRIMARY KEY (league_id, manager_id, tag)
    )`;

  // Wer beim letzten Abruf in der echten Aufstellung stand.
  await sql`ALTER TABLE kader ADD COLUMN IF NOT EXISTS aufgestellt BOOLEAN`;
  await sql`ALTER TABLE liga_settings ADD COLUMN IF NOT EXISTS spieltag_start TEXT DEFAULT 'fr'`;
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
    SELECT manager_id, player_id, name, position, marktwert, kaufpreis, punkte, aufgestellt, stand
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
      aufgestellt: z.aufgestellt === true,
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
    INSERT INTO liga_settings (league_id, user_id, stichtag, startbudget, punkte_bonus, login_aktiv, login_start, spieltag_start, notiz)
    VALUES (${leagueId}, ${schluessel},
            ${vorlage?.stichtag ?? null},
            ${vorlage?.startbudget ?? 50000000},
            ${vorlage?.punkte_bonus ?? 1000},
            ${vorlage?.login_aktiv ?? true},
            ${vorlage?.login_start ?? null},
            ${vorlage?.spieltag_start ?? 'fr'},
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

// Nachrichten einer Liga, Spieler-ID → Meldung.
export async function getNews(leagueId) {
  const zeilen = await sql`
    SELECT player_id, name, text, stimmung, quellen, stand
    FROM news WHERE league_id = ${leagueId}`;
  return new Map(zeilen.map((z) => [String(z.player_id), {
    name: z.name,
    text: z.text ?? "",
    stimmung: z.stimmung ?? "neutral",
    quellen: z.quellen ?? [],
    stand: z.stand,
  }]));
}

// Leere Einträge verwerfen: "nichts gefunden" aus einem Lauf, der in
// Wahrheit nicht funktioniert hat, blockiert die betroffenen Spieler sonst
// dauerhaft — sie gelten als erledigt und werden nie wieder abgefragt.
export async function verwerfeLeereNews(leagueId) {
  const weg = await sql`
    DELETE FROM news
    WHERE league_id = ${leagueId} AND (text IS NULL OR text = '')
    RETURNING player_id`;
  return weg.length;
}

export async function merkeNews(leagueId, meldungen) {
  if (!meldungen.length) return 0;
  await sql`
    INSERT INTO news (league_id, player_id, name, text, stimmung, quellen, stand)
    SELECT ${leagueId}::text, t.pid, t.nm, t.tx, t.st, t.qu::jsonb, NOW() FROM UNNEST(
      ${meldungen.map((m) => String(m.id))}::text[],
      ${meldungen.map((m) => m.name ?? null)}::text[],
      ${meldungen.map((m) => m.text ?? "")}::text[],
      ${meldungen.map((m) => m.stimmung ?? "neutral")}::text[],
      ${meldungen.map((m) => JSON.stringify(m.quellen ?? []))}::text[]
    ) AS t(pid, nm, tx, st, qu)
    ON CONFLICT (league_id, player_id) DO UPDATE SET
      name = EXCLUDED.name, text = EXCLUDED.text, stimmung = EXCLUDED.stimmung,
      quellen = EXCLUDED.quellen, stand = EXCLUDED.stand`;
  return meldungen.length;
}

// Den heutigen Stand festhalten. Mehrmals am Tag aktualisieren überschreibt
// denselben Eintrag — maßgeblich ist der letzte Stand des Tages.
export async function merkeTagesstand(leagueId, konten, tag) {
  const mit = konten.filter((k) => k.id != null);
  if (mit.length === 0 || !tag) return 0;

  await sql`
    INSERT INTO tagesstand (league_id, manager_id, tag, teamwert, konto, punkte)
    SELECT ${leagueId}::text, t.mid, ${tag}::date, t.tw, t.ko, t.pk FROM UNNEST(
      ${mit.map((k) => String(k.id))}::text[],
      ${mit.map((k) => Math.round(Number(k.teamwert ?? 0)))}::bigint[],
      ${mit.map((k) => Math.round(Number(k.konto ?? 0)))}::bigint[],
      ${mit.map((k) => Math.round(Number(k.punkte ?? 0)))}::int[]
    ) AS t(mid, tw, ko, pk)
    ON CONFLICT (league_id, manager_id, tag) DO UPDATE SET
      teamwert = EXCLUDED.teamwert, konto = EXCLUDED.konto, punkte = EXCLUDED.punkte`;
  return mit.length;
}

// Der jüngste Stand, der VOR heute liegt. Nicht stur "gestern": Wer zwei
// Tage nicht aktualisiert hat, soll trotzdem einen Vergleich bekommen.
export async function getVortag(leagueId) {
  const tage = await sql`
    SELECT MAX(tag) AS tag FROM tagesstand
    WHERE league_id = ${leagueId} AND tag < (NOW() AT TIME ZONE 'Europe/Berlin')::date`;
  const tag = tage[0]?.tag ?? null;
  if (!tag) return { tag: null, map: new Map() };

  const zeilen = await sql`
    SELECT manager_id, teamwert, konto, punkte FROM tagesstand
    WHERE league_id = ${leagueId} AND tag = ${tag}`;

  return {
    tag,
    map: new Map(zeilen.map((z) => [String(z.manager_id), {
      teamwert: Number(z.teamwert ?? 0),
      konto: Number(z.konto ?? 0),
      punkte: Number(z.punkte ?? 0),
    }])),
  };
}

// Wer in dieser Liga schon gehandelt hat — als Käufer oder Verkäufer.
//
// Das ist das verlässlichste Kennzeichen dafür, dass jemand mitspielt.
// Der Feed führt Manager über den Anzeigenamen, deshalb Namen und keine IDs.
export async function getAktiveManager(leagueId) {
  const zeilen = await sql`
    SELECT DISTINCT name FROM (
      SELECT buyer AS name FROM events
        WHERE league_id = ${leagueId} AND type = 15 AND buyer IS NOT NULL
      UNION
      SELECT seller AS name FROM events
        WHERE league_id = ${leagueId} AND type = 15 AND seller IS NOT NULL
    ) x`;
  return new Set(zeilen.map((z) => z.name));
}

// ── Marktwert-Trend ─────────────────────────────────────────────────
//
// Wie viel haben die Spieler eines Managers bei der letzten
// Marktwertanpassung gewonnen oder verloren?
//
// Gerechnet wird je Spieler: sein Marktwert am jüngsten Marktwert-Tag
// minus sein Marktwert am Tag davor, aufsummiert über den aktuellen Kader.
// Ein Transfer kann darin nicht landen — ein Kaufpreis kommt in der
// Rechnung nirgends vor, und gezählt wird nur, wer an beiden Tagen einen
// abgelesenen Wert hat. Der frühere Trend verglich dagegen gespeicherte
// Teamwerte, in denen jeder Zukauf als Anstieg auftauchte.
export async function getMwTrend(leagueId) {
  const tage = await sql`
    SELECT DISTINCT tag FROM mw_beobachtung ORDER BY tag DESC LIMIT 2`;
  if (tage.length < 2) return { map: new Map(), tag: tage[0]?.tag ?? null, vortag: null };

  const [neu, alt] = [tage[0].tag, tage[1].tag];

  const zeilen = await sql`
    SELECT k.manager_id,
           SUM(h.marktwert - v.marktwert) AS trend,
           SUM(v.marktwert)               AS basis,
           COUNT(*)                       AS spieler,
           SUM(CASE WHEN h.marktwert > v.marktwert THEN 1 ELSE 0 END) AS gestiegen,
           SUM(CASE WHEN h.marktwert < v.marktwert THEN 1 ELSE 0 END) AS gefallen
    FROM kader k
    JOIN mw_beobachtung h ON h.player_id = k.player_id AND h.tag = ${neu}
    JOIN mw_beobachtung v ON v.player_id = k.player_id AND v.tag = ${alt}
    WHERE k.league_id = ${leagueId}
    GROUP BY k.manager_id`;

  const map = new Map();
  for (const z of zeilen) {
    const basis = Number(z.basis);
    map.set(String(z.manager_id), {
      trend: Number(z.trend),
      anteil: basis > 0 ? Number(z.trend) / basis : null,
      spieler: Number(z.spieler),
      gestiegen: Number(z.gestiegen),
      gefallen: Number(z.gefallen),
    });
  }
  return { map, tag: neu, vortag: alt };
}

// Die Marktwerte eines Kaders für den laufenden Marktwert-Tag festhalten.
// Zweimal am selben Tag ablesen überschreibt denselben Eintrag.
export async function merkeMarktwerte(spieler, tag) {
  const mit = spieler.filter((s) => s.id != null && Number(s.marktwert) > 0);
  if (mit.length === 0 || !tag) return 0;

  await sql`
    INSERT INTO mw_beobachtung (player_id, tag, marktwert)
    SELECT t.pid, ${tag}::date, t.mw FROM UNNEST(
      ${mit.map((s) => String(s.id))}::text[],
      ${mit.map((s) => Number(s.marktwert))}::bigint[]
    ) AS t(pid, mw)
    ON CONFLICT (player_id, tag) DO UPDATE SET marktwert = EXCLUDED.marktwert`;
  return mit.length;
}

// Wer braucht überhaupt neue Daten?
//
// Nicht nach Zeitfenster raten, sondern nachsehen. Der Feed weiß, was
// passiert ist:
//
// Beide ändern sich aus zwei Gründen:
//
//   durch einen Transfer  — dann ändert sich die Zusammensetzung des Kaders
//                           und mit ihr der Teamwert. Betrifft nur den einen
//                           Manager, und der Feed sagt uns, wen.
//
//   durch die tägliche    — Kickbase passt die Marktwerte einmal am Tag an.
//   Marktwertanpassung      Danach sind sowohl der Teamwert als auch die in
//                           kader gespeicherten Marktwerte je Spieler
//                           veraltet. Mit letzteren rechnet der
//                           Verkaufsrechner, deshalb reicht es nicht, nur
//                           den Teamwert zu erneuern.
//
// Also: neu holen, wenn es noch keinen Stand gibt, wenn der Stand von vor
// der letzten Mitternacht ist, oder wenn seither ein Transfer lief.
//
// Damit fehlt nie etwas, und trotzdem wird nichts doppelt geholt.
export async function werBrauchtNeueDaten(leagueId, manager) {
  const namen = new Map(manager.map((m) => [String(m.i), m.n]));

  const kaderStand = new Map(
    (await sql`
      SELECT manager_id, MAX(stand) AS stand FROM kader
      WHERE league_id = ${leagueId} GROUP BY manager_id`
    ).map((z) => [String(z.manager_id), z.stand])
  );

  const twStand = new Map(
    (await sql`
      SELECT manager_id, stand FROM teamwerte WHERE league_id = ${leagueId}`
    ).map((z) => [String(z.manager_id), z.stand])
  );

  // Letzter Transfer je Managername, damit wir nicht je Manager abfragen
  const letzterTransfer = new Map();
  for (const z of await sql`
    SELECT name, MAX(dt) AS dt FROM (
      SELECT buyer AS name, dt FROM events
        WHERE league_id = ${leagueId} AND type = 15 AND buyer IS NOT NULL
      UNION ALL
      SELECT seller AS name, dt FROM events
        WHERE league_id = ${leagueId} AND type = 15 AND seller IS NOT NULL
    ) x GROUP BY name`) {
    letzterTransfer.set(z.name, new Date(z.dt));
  }

  // Veraltet ist ein Stand, der vor der letzten Mitternacht ODER vor der
  // letzten Marktwertanpassung liegt. Die Anpassung um 22:04 ändert jeden
  // Teamwert und jeden in `kader` gespeicherten Marktwert — ohne diesen
  // Bezug fehlte für alle, die abends aktualisieren, genau die Ablesung,
  // aus der der Trend entsteht.
  const mwUpdate = letztesMwUpdate()?.getTime() ?? 0;
  const bezug = Math.max(mitternachtDeutsch().getTime(), mwUpdate);

  const kaderNoetig = [];
  const twNoetig = [];

  for (const m of manager) {
    const id = String(m.i);
    const name = namen.get(id);
    const transfer = letzterTransfer.get(name) ?? null;

    const veraltet = (stand) =>
      !stand ||
      new Date(stand).getTime() < bezug ||
      (transfer && transfer > new Date(stand));

    if (veraltet(kaderStand.get(id))) kaderNoetig.push(m.i);
    if (veraltet(twStand.get(id))) twNoetig.push(m.i);
  }

  return { kader: kaderNoetig, teamwerte: twNoetig };
}

// Letzte Mitternacht in deutscher Zeit als echter Zeitpunkt.
export function mitternachtDeutsch() {
  const jetzt = new Date();
  const tag = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(jetzt);
  // Versatz über einen bekannten Zeitpunkt bestimmen
  const alsUtc = Date.parse(`${tag}T00:00:00Z`);
  const teile = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(alsUtc)).reduce((a, t) => ((a[t.type] = t.value), a), {});
  const versatz = Date.UTC(
    Number(teile.year), Number(teile.month) - 1, Number(teile.day),
    Number(teile.hour) % 24, Number(teile.minute), Number(teile.second)
  ) - alsUtc;
  return new Date(alsUtc - versatz);
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
