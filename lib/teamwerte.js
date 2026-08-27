import { kbFetch } from "./kickbase";
import { sql } from "./db";

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ladeTeamwerte(leagueId, managerIds, token, opt = {}) {
  const { frist = Date.now() + 45_000 } = opt;
  let geladen = 0;

  for (const uid of managerIds) {
    if (Date.now() > frist) {
      return { geladen, gesamt: managerIds.length, gestoppt: true };
    }

    try {
      const d = await kbFetch(`/v4/leagues/${leagueId}/managers/${uid}/dashboard`, token);
      const tv = Number(d.tv ?? 0);
      const anzahl = Number(d.t ?? 0);

      await sql`
        INSERT INTO teamwerte (league_id, manager_id, teamwert, spieler, stand)
        VALUES (${leagueId}, ${String(uid)}, ${tv}, ${anzahl}, NOW())
        ON CONFLICT (league_id, manager_id) DO UPDATE
          SET teamwert = ${tv}, spieler = ${anzahl}, stand = NOW()`;

      // Verlauf nur fortschreiben, wenn sich der Wert wirklich geändert hat.
      // Sonst würde zweimaliges Aktualisieren den Trend auf 0 setzen.
      await sql`
        INSERT INTO teamwert_verlauf (league_id, manager_id, teamwert, stand)
        SELECT ${leagueId}, ${String(uid)}, ${tv}, NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM teamwert_verlauf v
          WHERE v.league_id = ${leagueId} AND v.manager_id = ${String(uid)}
            AND v.teamwert = ${tv}
            AND v.stand = (
              SELECT MAX(w.stand) FROM teamwert_verlauf w
              WHERE w.league_id = v.league_id AND w.manager_id = v.manager_id
            )
        )
        ON CONFLICT (league_id, manager_id, stand) DO NOTHING`;

      geladen++;
    } catch {
      // Manager überspringen
    }
    await schlaf(180);
  }

  return { geladen, gesamt: managerIds.length, gestoppt: false };
}
