import { sql } from "./db";

// Spielernamen nach ID.
//
// Der Kader-Endpoint liefert Position, Marktwert und Kaufpreis, aber unter
// keinem der bekannten Felder einen Namen — im Kader stand deshalb überall
// "Unbekannt". Statt weitere Feldnamen zu raten, kommen die Namen aus zwei
// Quellen, die wir ohnehin haben:
//
//   1. dem Bundesliga-Pool (pool_cache), gefüllt aus den Vereinskadern
//   2. den Events dieser Liga — jeder Transfer trägt den Spielernamen
//
// Quelle 2 erwischt auch Spieler, die heute in keinem Bundesliga-Kader mehr
// stehen, aber in dieser Liga mal gehandelt wurden.
export async function holeNamen(leagueId) {
  const namen = new Map();

  const cache = await sql`SELECT daten FROM pool_cache WHERE id = 'bundesliga_v2'`;
  for (const s of cache[0]?.daten?.spieler ?? []) {
    if (s.id && s.name && s.name !== "Unbekannt") namen.set(String(s.id), s.name);
  }

  const ausEvents = await sql`
    SELECT player_id, MAX(player_name) AS name
    FROM events
    WHERE league_id = ${leagueId} AND player_id IS NOT NULL AND player_name IS NOT NULL
    GROUP BY player_id`;
  for (const z of ausEvents) {
    // Events gewinnen: der Feed schreibt den Namen so, wie die Liga ihn sieht
    if (z.name) namen.set(String(z.player_id), z.name);
  }

  return namen;
}

// Name für einen Spieler, mit der ID als letzter Rückfallebene — "Unbekannt"
// dreizehnmal untereinander sagt niemandem etwas, "#4711" wenigstens etwas.
export function benenne(spieler, namen) {
  const gefunden = namen.get(String(spieler.id));
  if (gefunden) return gefunden;
  if (spieler.name && spieler.name !== "Unbekannt") return spieler.name;
  return spieler.id ? `Spieler #${spieler.id}` : "Unbekannt";
}
