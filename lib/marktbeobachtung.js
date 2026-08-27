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
    };
  });

  const vorher = (await sql`
    SELECT COUNT(*)::int AS n FROM markt_beobachtung WHERE league_id = ${leagueId}`)[0].n;

  await sql`
    INSERT INTO markt_beobachtung (league_id, player_id, ablauf, gesehen)
    SELECT ${leagueId}::text, *, NOW() FROM UNNEST(
      ${eintraege.map((e) => e.id)}::text[],
      ${eintraege.map((e) => e.ablauf)}::timestamptz[]
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
// Käufe zwischen zwei Managern zählen nicht: die betreffen Spieler, die
// jemandem gehören, und folgen nicht dem Rhythmus der freien Spieler.
export async function sammleBeobachtungen(leagueId, stichtag) {
  const zeilen = await sql`
    SELECT player_id, dt FROM events
    WHERE league_id = ${leagueId} AND player_id IS NOT NULL AND dt >= ${stichtag}
      AND (type = 3 OR (type = 15 AND seller IS NULL))
    UNION ALL
    SELECT player_id, gesehen AS dt FROM markt_beobachtung
    WHERE league_id = ${leagueId} AND gesehen >= ${stichtag}`;

  const proSpieler = new Map();
  for (const z of zeilen) {
    const id = String(z.player_id);
    if (!proSpieler.has(id)) proSpieler.set(id, []);
    proSpieler.get(id).push(new Date(z.dt));
  }
  return proSpieler;
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
