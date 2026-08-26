import { cookies } from "next/headers";
import { initSchema, getSettings, sql } from "@/lib/db";
import { rekonstruiere } from "@/lib/rekonstruktion";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) return Response.json({ error: "nicht angemeldet" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");
  if (!leagueId) return Response.json({ error: "league fehlt" }, { status: 400 });

  const neustart = searchParams.get("neustart") === "1";
  const zurueck = searchParams.get("zurueck") === "1";

  try {
    await initSchema();
    const settings = await getSettings(leagueId);

    const log = await sql`SELECT * FROM rekon_log WHERE league_id = ${leagueId}`;
    const abIndex = neustart ? 0 : (log[0]?.position ?? 0);

    const e = await rekonstruiere(leagueId, token, settings.stichtag, { abIndex });
    const gefunden = (neustart ? 0 : (log[0]?.gefunden ?? 0)) + e.neu;

    await sql`
      INSERT INTO rekon_log (league_id, position, fertig, letzter, gefunden)
      VALUES (${leagueId}, ${e.index}, ${e.fertig}, NOW(), ${gefunden})
      ON CONFLICT (league_id) DO UPDATE
        SET position = ${e.index}, fertig = ${e.fertig}, letzter = NOW(), gefunden = ${gefunden}`;

    if (zurueck) {
      const params = new URLSearchParams({
        league: leagueId,
        rekon: `${e.index}/${e.gesamt} Spieler geprüft · ${gefunden} Transfers${e.fertig ? " · fertig" : " · nochmal klicken"}`,
      });
      return Response.redirect(new URL(`/liga?${params}`, request.url), 303);
    }
    return Response.json({ ...e, gefunden });
  } catch (err) {
    if (zurueck) {
      return Response.redirect(
        new URL(`/liga?league=${leagueId}&fehler=${encodeURIComponent(err.message)}`, request.url),
        303
      );
    }
    return Response.json({ error: err.message }, { status: 500 });
  }
}
