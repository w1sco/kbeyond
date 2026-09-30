import { initSchema } from "@/lib/db";
import { pruefeApi, sitzung } from "@/lib/auth";
import { importiereLeistungen, standLeistungen } from "@/lib/matchupabruf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Das Schema legt jede Runde gut 40 Abfragen lang neu an, obwohl es nach
// der ersten steht. Eine warme Instanz merkt sich, dass es erledigt ist.
let schemaSteht = false;

// Ein Bündel Punkte je Spieler holen; der Browser ruft wiederholt auf.
//
// Derselbe Weg wie /api/startelf und aus demselben Grund: Ein Aufruf je
// Spieler mal 600 ms Mindestabstand passt nicht in Vercels 60 Sekunden.
//
// **Die Antwort kommt als Strom, eine Zeile je Spieler.** Vorher kam sie
// erst nach 45 Sekunden am Stück, und so lange stand die Anzeige still —
// es sah aus, als hinge der Abruf. Jetzt zählt der Browser live mit. Die
// letzte Zeile trägt `ende: true` und den Stand, wie zuvor die ganze Antwort.
export async function POST(request) {
  const { token } = await sitzung();
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");

  const abgelehnt = await pruefeApi(request, leagueId, token);
  if (abgelehnt) return abgelehnt;

  if (!schemaSteht) {
    await initSchema();
    schemaSteht = true;
  }

  const kodierer = new TextEncoder();
  const strom = new ReadableStream({
    async start(controller) {
      const senden = (o) => {
        try { controller.enqueue(kodierer.encode(JSON.stringify(o) + "\n")); }
        catch { /* Browser ist weg — der Lauf hört über das Signal auf */ }
      };
      try {
        const lauf = await importiereLeistungen(token, {
          melde: (fortschritt) => senden({ fortschritt }),
          abbruch: request.signal,
        });
        const stand = await standLeistungen();
        senden({ ...lauf, stand, ende: true });
      } catch (e) {
        senden({ fehler: e?.message ?? "unbekannter Fehler", gedrosselt: Boolean(e?.gedrosselt), ende: true });
      }
      try { controller.close(); } catch { /* schon zu */ }
    },
  });

  return new Response(strom, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Kein Puffern auf dem Weg, sonst käme der Strom doch am Stück.
      "X-Accel-Buffering": "no",
    },
  });
}
