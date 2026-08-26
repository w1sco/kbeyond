import { cookies } from "next/headers";
import { sql, initSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) return Response.json({ error: "nicht angemeldet" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");
  if (!leagueId) return Response.json({ error: "league fehlt" }, { status: 400 });

  await initSchema();

  const vorher = (await sql`SELECT COUNT(*)::int AS n FROM events WHERE league_id = ${leagueId}`)[0].n;

  await sql`
    DELETE FROM events
    WHERE league_id = ${leagueId} AND id LIKE 'rk\_%'`;

  await sql`
    UPDATE rekon_log SET position = 0, fertig = FALSE, gefunden = 0
    WHERE league_id = ${leagueId}`;

  const nachher = (await sql`SELECT COUNT(*)::int AS n FROM events WHERE league_id = ${leagueId}`)[0].n;

  return Response.json({ vorher, nachher, geloescht: vorher - nachher });
}
