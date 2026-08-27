import { sql } from "./db";
import { normalisiereSpieler, findeSpielerListe } from "./format";

const BASE = "https://api.kickbase.com";

// Schreibt mit, wer gerade auf dem Transfermarkt steht.
//
// Der Live-Markt ist flüchtig: Was jetzt dort steht, ist morgen weg, und der
// Feed liefert nur die letzten ~670 Einträge. Ohne Mitschrift fehlt später
// genau die Beobachtung, aus der sich der Rhythmus ergibt.
//
// Ein Angebot wird über seinen Ablaufzeitpunkt identifiziert (auf die Minute
// gerundet, weil die Restzeit sekundenweise weiterläuft). Zweimal
// aktualisieren legt dasselbe Angebot deshalb nicht zweimal ab.
export async function speichereMarkt(leagueId, token) {
  const res = await fetch(`${BASE}/v4/leagues/${leagueId}/market`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Markt: HTTP ${res.status}`);

  const daten = await res.json();
  const liste = (daten.it ?? daten.items ?? daten.players ?? findeSpielerListe(daten) ?? [])
    .map(normalisiereSpieler)
    .filter((s) => s.id != null);

  if (liste.length === 0) return { gesehen: 0, neu: 0 };

  const jetzt = Date.now();
  const eintraege = liste.map((s) => {
    // exs ist die Restzeit in Sekunden. Auf die Minute runden, damit
    // dasselbe Angebot bei zwei Abrufen denselben Schlüssel bekommt.
    const restSek = Number(s.ablauf);
    const ablaufMs = Number.isFinite(restSek) && restSek > 0 ? jetzt + restSek * 1000 : jetzt;
    return {
      id: String(s.id),
      ablauf: new Date(Math.round(ablaufMs / 60_000) * 60_000).toISOString(),
      // Der Marktwert im Moment des Angebots – die Bezugsgröße für den
      // Aufschlag, den ein Käufer später zahlt.
      marktwert: s.marktwert == null ? null : Number(s.marktwert),
    };
  });

  const vorher = (await sql`
    SELECT COUNT(*)::int AS n FROM markt_beobachtung WHERE league_id = ${leagueId}`)[0].n;

  await sql`
    INSERT INTO markt_beobachtung (league_id, player_id, ablauf, marktwert, gesehen)
    SELECT ${leagueId}::text, *, NOW() FROM UNNEST(
      ${eintraege.map((e) => e.id)}::text[],
      ${eintraege.map((e) => e.ablauf)}::timestamptz[],
      ${eintraege.map((e) => e.marktwert)}::bigint[]
    )
    ON CONFLICT (league_id, player_id, ablauf) DO NOTHING`;

  const nachher = (await sql`
    SELECT COUNT(*)::int AS n FROM markt_beobachtung WHERE league_id = ${leagueId}`)[0].n;

  return { gesehen: liste.length, neu: nachher - vorher };
}

// Alle Beobachtungen "war am Markt" je Spieler, seit dem Stichtag.
//
// Drei Quellen in einer Zeitreihe:
//   Typ 3            das Erscheinen am Markt — die beste Quelle
//   Typ 15 ohne slr  Kauf von Kickbase, der Spieler war also am Markt
//   Mitschrift       was wir selbst am Markt gesehen haben
//
// ── Nur Angebote von Kickbase zählen ────────────────────────────────
//
// Typ 3 feuert auch, wenn ein *Mitspieler* einen Spieler anbietet. Solche
// Auftritte folgen keinem Rhythmus — sie hängen an der Laune des Besitzers.
// Wer kauft und zwei Tage später wieder anbietet, erzeugt einen Abstand von
// zwei Tagen, und genug davon drücken den Median der ganzen Liga nach unten.
// Dann steht überall "überfällig", obwohl der echte Rhythmus 14 Tage ist.
//
// Gehörte der Spieler jemandem? Das sagt der letzte Transfer davor: hatte er
// einen Käufer, war der Spieler in einem Kader; stand dort nur ein Verkäufer,
// ging er zurück an Kickbase und war frei.
export async function sammleBeobachtungen(leagueId, stichtag) {
  const zeilen = await sql`
    WITH auftritt AS (
      SELECT player_id, dt FROM events
      WHERE league_id = ${leagueId} AND player_id IS NOT NULL AND dt >= ${stichtag}
        AND (type = 3 OR (type = 15 AND seller IS NULL))
      UNION ALL
      SELECT player_id, gesehen AS dt FROM markt_beobachtung
      WHERE league_id = ${leagueId} AND gesehen >= ${stichtag}
    )
    SELECT a.player_id, a.dt FROM auftritt a
    WHERE NOT EXISTS (
      SELECT 1 FROM events t
      WHERE t.league_id = ${leagueId} AND t.type = 15
        AND t.player_id = a.player_id
        AND t.buyer IS NOT NULL
        AND t.dt = (
          SELECT MAX(x.dt) FROM events x
          WHERE x.league_id = ${leagueId} AND x.type = 15
            AND x.player_id = a.player_id AND x.dt < a.dt
        )
    )`;

  // Wie viele Auftritte dabei ausgeschlossen wurden — damit die Seite sagen
  // kann, worauf die Schätzung beruht.
  const fremd = await sql`
    SELECT COUNT(*)::int AS n FROM events e
    WHERE e.league_id = ${leagueId} AND e.type = 3 AND e.dt >= ${stichtag}
      AND EXISTS (
        SELECT 1 FROM events t
        WHERE t.league_id = ${leagueId} AND t.type = 15
          AND t.player_id = e.player_id AND t.buyer IS NOT NULL
          AND t.dt = (
            SELECT MAX(x.dt) FROM events x
            WHERE x.league_id = ${leagueId} AND x.type = 15
              AND x.player_id = e.player_id AND x.dt < e.dt
          )
      )`;

  const proSpieler = new Map();
  for (const z of zeilen) {
    const id = String(z.player_id);
    if (!proSpieler.has(id)) proSpieler.set(id, []);
    proSpieler.get(id).push(new Date(z.dt));
  }
  return { beobachtungen: proSpieler, fremdangebote: fremd[0]?.n ?? 0 };
}

// Wann wurde ein Spieler zuletzt an Kickbase verkauft?
//
// Ein Verkauf an Kickbase (Transfer mit Verkäufer, ohne Käufer) macht den
// Spieler wieder frei und setzt damit die Uhr für seine Rückkehr neu.
export async function letzteVerkaeufe(leagueId, stichtag) {
  const zeilen = await sql`
    SELECT player_id, MAX(dt) AS dt FROM events
    WHERE league_id = ${leagueId} AND type = 15 AND dt >= ${stichtag}
      AND player_id IS NOT NULL
      AND buyer IS NULL AND seller IS NOT NULL
    GROUP BY player_id`;
  return new Map(zeilen.map((z) => [String(z.player_id), new Date(z.dt)]));
}

// Wer steht gerade am Markt? Aus der Mitschrift, damit die Marktseite dafür
// keinen eigenen Live-Abruf braucht.
export async function aktuellAmMarkt(leagueId) {
  const zeilen = await sql`
    SELECT player_id, MAX(ablauf) AS ablauf FROM markt_beobachtung
    WHERE league_id = ${leagueId} AND ablauf > NOW()
    GROUP BY player_id`;
  return new Map(zeilen.map((z) => [String(z.player_id), new Date(z.ablauf)]));
}

// Ein Angebot steht rund einen Tag; so weit wird rückwärts nach dem
// zugehörigen Marktwert gesucht.
const AUFSCHLAG_FENSTER = "36 hours";

export async function holeAufschlaege(leagueId, stichtag, abDatum = null) {
  const ab = abDatum ?? stichtag;

  return await sql`
    SELECT
      k.dt,
      k.buyer,
      k.player_id,
      k.player_name,
      k.price::bigint AS preis,
      COALESCE(
        (SELECT (a.raw->>'mv')::bigint
         FROM events a
         WHERE a.league_id = k.league_id AND a.type = 3
           AND a.player_id = k.player_id
           AND a.dt <= k.dt AND a.dt > k.dt - ${AUFSCHLAG_FENSTER}::interval
           AND a.raw ? 'mv'
         ORDER BY a.dt DESC LIMIT 1),
        (SELECT m.marktwert
         FROM markt_beobachtung m
         WHERE m.league_id = k.league_id AND m.player_id = k.player_id
           AND m.marktwert IS NOT NULL
           AND m.gesehen <= k.dt AND m.gesehen > k.dt - ${AUFSCHLAG_FENSTER}::interval
         ORDER BY m.gesehen DESC LIMIT 1),
        -- Dritte Quelle: die Marktwert-Historie des Spielers. Sie trägt auch
        -- Käufe, deren Angebot längst aus dem Feed-Fenster gefallen ist.
        -- Der Wert des Kauftags, sonst der letzte davor.
        (SELECT v.marktwert
         FROM marktwert_verlauf v
         WHERE v.player_id = k.player_id AND v.tag <= k.dt::date
         ORDER BY v.tag DESC LIMIT 1)
      ) AS marktwert
    FROM events k
    WHERE k.league_id = ${leagueId} AND k.type = 15
      AND k.buyer IS NOT NULL
      AND k.dt >= ${stichtag} AND k.dt >= ${ab}
    ORDER BY k.dt DESC`;
}
