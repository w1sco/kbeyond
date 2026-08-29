import { cookies } from "next/headers";
import { pruefeApi, sitzung } from "@/lib/auth";
import { initSchema } from "@/lib/db";
import { kbFetch } from "@/lib/kickbase";
import { holeMitspieler } from "@/lib/mitspieler";
import { sucheLivePfad } from "@/lib/liveabruf";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Sucht den Endpunkt für die Live-Punkte und merkt ihn.
//
// Das kostet bis zu elf Anfragen, deshalb läuft es **nur auf Klick** und
// nicht beim Rendern der Seite. Danach genügt ein Aufruf je Seitenaufruf.
export async function POST(request) {
  const token = (await cookies()).get("kb_token")?.value;
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");

  const abgelehnt = await pruefeApi(request, leagueId, token, "/liga/live");
  if (abgelehnt) return abgelehnt;

  const zurueck = searchParams.get("zurueck") === "1";

  try {
    await initSchema();
    const { uid } = await sitzung();
    const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
    const ids = (await holeMitspieler(leagueId, ranking)).map((m) => String(m.i));

    const e = await sucheLivePfad(leagueId, token, ids, uid);

    if (zurueck) {
      const params = new URLSearchParams({
        league: leagueId,
        live: e.gefunden
          ? `Endpunkt gefunden: ${e.gefunden.pfad} — ${e.gefunden.manager} Manager, Punkte im Feld ${e.gefunden.punkteFeld}`
          : `Kein Endpunkt liefert Live-Punkte (${e.versucht.length} probiert)`,
      });
      return Response.redirect(new URL(`/liga/live?${params}`, request.url), 303);
    }
    return Response.json(e);
  } catch (err) {
    if (zurueck) {
      return Response.redirect(
        new URL(`/liga/live?league=${leagueId}&fehler=${encodeURIComponent(err.message)}`, request.url),
        303
      );
    }
    return Response.json({ error: err.message }, { status: 500 });
  }
}
