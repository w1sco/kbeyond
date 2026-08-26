import { cookies } from "next/headers";
import { initSchema } from "@/lib/db";
import { kbFetch } from "@/lib/kickbase";
import { ladeKader } from "@/lib/kader";
import { pruefeApi } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request) {
  const token = (await cookies()).get("kb_token")?.value;
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");

  const abgelehnt = await pruefeApi(request, leagueId, token);
  if (abgelehnt) return abgelehnt;

  const zurueck = searchParams.get("zurueck") === "1";

  try {
    await initSchema();
    const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
    const ids = (ranking.us ?? []).filter((m) => m.adm !== true).map((m) => m.i);

    const e = await ladeKader(leagueId, ids, token);

    if (zurueck) {
      const text = e.leer > 0
        ? `Kader geladen (${e.geladen}/${e.gesamt}, ${e.spieler} Spieler) — ${e.leer} Manager ohne auswertbare Liste`
        : `Kader geladen (${e.geladen}/${e.gesamt}, ${e.spieler} Spieler)${e.gestoppt ? " — nochmal klicken" : ""}`;
      return Response.redirect(
        new URL(`/liga?${new URLSearchParams({ league: leagueId, tw: text })}`, request.url), 303);
    }
    return Response.json(e);
  } catch (err) {
    if (zurueck) {
      return Response.redirect(
        new URL(`/liga?league=${leagueId}&fehler=${encodeURIComponent(err.message)}`, request.url), 303);
    }
    return Response.json({ error: err.message }, { status: 500 });
  }
}
