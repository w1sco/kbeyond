import { initSchema } from "@/lib/db";
import { pruefeApi, sitzung } from "@/lib/auth";
import { importiereLeistungen, standLeistungen } from "@/lib/matchupabruf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ein Bündel Punkte je Spieler holen; der Browser ruft wiederholt auf.
//
// Derselbe Weg wie /api/startelf und aus demselben Grund: Ein Aufruf je
// Spieler mal 600 ms Mindestabstand passt nicht in Vercels 60 Sekunden.
// Ein Lauf holt, was in sein Zeitbudget passt, und sagt in `offen`, wie
// viel noch fehlt.
export async function POST(request) {
  const { token } = await sitzung();
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");

  const abgelehnt = await pruefeApi(request, leagueId, token);
  if (abgelehnt) return abgelehnt;

  await initSchema();

  try {
    const lauf = await importiereLeistungen(token);
    const stand = await standLeistungen();
    return Response.json({ ...lauf, stand });
  } catch (e) {
    return Response.json(
      { fehler: e?.message ?? "unbekannter Fehler", gedrosselt: Boolean(e?.gedrosselt) },
      { status: 200 }
    );
  }
}
