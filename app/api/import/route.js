import { cookies } from "next/headers";
import { initSchema, logImport, getImportStatus } from "@/lib/db";
import { importiere } from "@/lib/importer";

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
    const status = await getImportStatus(leagueId);

    // Erstimport: alles laden. Danach: nur Neues.
    const erstlauf = !status.komplett;

    const ergebnis = await importiere(leagueId, token, {
      vollstaendig: erstlauf,
      startAb: erstlauf ? status.offsetPos : 0,
    });

    await logImport(
      leagueId,
      ergebnis.neu,
      ergebnis.gesamt,
      ergebnis.naechsterStart,
      erstlauf ? ergebnis.fertig : true
    );

    if (zurueck) {
      const params = new URLSearchParams({
        league: leagueId,
        neu: String(ergebnis.neu),
      });
      if (ergebnis.gestoppt) params.set("hinweis", ergebnis.gestoppt);
      return Response.redirect(new URL(`/liga?${params}`, request.url), 303);
    }
    return Response.json(ergebnis);
  } catch (e) {
    if (zurueck) {
      const url = new URL(
        `/liga?league=${leagueId}&fehler=${encodeURIComponent(e.message)}`,
        request.url
      );
      return Response.redirect(url, 303);
    }
    return Response.json({ error: e.message }, { status: 500 });
  }
}
