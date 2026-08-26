import { cookies } from "next/headers";
import { sql, initSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) return Response.json({ error: "nicht angemeldet" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");
  if (!leagueId) return Response.json({ error: "league fehlt" }, { status: 400 });

  const alles = searchParams.get("alles") === "1";

  await initSchema();
  const vorher = (await sql`SELECT COUNT(*)::int AS n FROM events WHERE league_id = ${leagueId}`)[0].n;

  if (alles) {
    await sql`DELETE FROM events WHERE league_id = ${leagueId} AND id LIKE 'rk\_%'`;
    await sql`UPDATE rekon_log SET position = 0, fertig = FALSE, gefunden = 0 WHERE league_id = ${leagueId}`;
  } else {
    // Nur rk-Einträge löschen, für die es einen echten Feed-Eintrag gibt
    await sql`
      DELETE FROM events a
      WHERE a.league_id = ${leagueId} AND a.id LIKE 'rk\_%'
        AND EXISTS (
          SELECT 1 FROM events b
          WHERE b.league_id = a.league_id
            AND b.id NOT LIKE 'rk\_%'
            AND b.type = 15
            AND b.player_id = a.player_id
            AND date_trunc('minute', b.dt) = date_trunc('minute', a.dt)
        )`;
  }

  const nachher = (await sql`SELECT COUNT(*)::int AS n FROM events WHERE league_id = ${leagueId}`)[0].n;
  return Response.json({ vorher, nachher, geloescht: vorher - nachher, modus: alles ? "alle rk" : "nur Duplikate" });
}
