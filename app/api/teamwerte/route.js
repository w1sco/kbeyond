import { cookies } from "next/headers";
import { initSchema } from "@/lib/db";
import { kbFetch } from "@/lib/kickbase";
import { ladeTeamwerte } from "@/lib/teamwerte";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) return Response.json({ error: "nicht angemeldet" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");
  if (!leagueId) return Response.json({ error: "league fehlt" }, { status: 400 });

  const zurueck = searchParams.get("zurueck") === "1";

  try {
    await initSchema();
    const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
    const ids = (ranking.us ?? []).filter((m) => m.adm !== true).map((m) => m.i);

    const e = await ladeTeamwerte(leagueId, ids, token);

    if (zurueck) {
      const params = new URLSearchParams({
        league: leagueId,
        tw: `Teamwerte aktualisiert (${e.geladen}/${e.gesamt})`,
      });
      return Response.redirect(new URL(`/liga?${params}`, request.url), 303);
    }
    return Response.json(e);
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
