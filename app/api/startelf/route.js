import { initSchema } from "@/lib/db";
import { pruefeApi, sitzung } from "@/lib/auth";
import { importiereStartelf, standStartelf } from "@/lib/startelfabruf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ein Bündel je Aufruf, der Browser ruft wiederholt auf.
//
// Warum nicht alles in einem Request: Ein Aufruf je Spieler mal rund 470
// Spieler mal 600 ms Mindestabstand sind über fünf Minuten — Vercel bricht
// nach 60 s hart ab. Ein Lauf holt deshalb, was in sein Zeitbudget passt,
// und sagt in `offen`, wie viel noch fehlt. Für den Nutzer ist es
// trotzdem **ein Klick**: Die Oberfläche fasst selbst nach.
//
// Derselbe Weg wie bei den News — und aus demselben Grund: Ein Abbruch
// kostet nur das laufende Bündel, alles davor steht schon in der
// Datenbank.
export async function POST(request) {
  const { token } = await sitzung();
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");

  const abgelehnt = await pruefeApi(request, leagueId, token);
  if (abgelehnt) return abgelehnt;

  await initSchema();

  try {
    const lauf = await importiereStartelf(token);
    const stand = await standStartelf();
    return Response.json({ ...lauf, stand });
  } catch (e) {
    // Eine Drosselung ist kein Fehler der Oberfläche — sie soll aufhören
    // nachzufassen, statt es sofort wieder zu versuchen.
    return Response.json(
      { fehler: e?.message ?? "unbekannter Fehler", gedrosselt: Boolean(e?.gedrosselt) },
      { status: 200 }
    );
  }
}
