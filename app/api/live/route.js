import { cookies } from "next/headers";
import { pruefeApi, sitzung } from "@/lib/auth";
import { initSchema } from "@/lib/db";
import { kbFetch } from "@/lib/kickbase";
import { holeMitspieler } from "@/lib/mitspieler";
import { sucheLivePfad, sucheSpielerPunkte, holeLivestand } from "@/lib/liveabruf";

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

    // Ist der Manager-Endpunkt gefunden, gleich weitersuchen: Er liefert
    // die Elf (`lp`), aber keine Punkte je Spieler. Die echten IDs aus
    // `lp` sind dabei der Anker — deshalb erst jetzt und nicht vorher.
    let spieler = null;
    if (e.gefunden) {
      const stand = await holeLivestand(leagueId, token, ids, new Map());
      const ausAufstellung = [...(stand?.aufstellung?.values() ?? [])].flat();
      if (!stand?.spieler?.size && ausAufstellung.length) {
        spieler = await sucheSpielerPunkte(leagueId, token, uid, ausAufstellung);
      }
    }

    if (zurueck) {
      const teile = [];
      teile.push(
        e.gefunden
          ? `Manager-Punkte: ${e.gefunden.pfad} (Feld ${e.gefunden.punkteFeld}, ${e.gefunden.manager} Manager)`
          : `Kein Endpunkt liefert Live-Punkte (${e.versucht.length} probiert)`
      );
      if (spieler) {
        teile.push(
          spieler.gefunden
            ? `Einzelpunkte: ${spieler.gefunden.pfad} (Feld ${spieler.gefunden.punkteFeld}, ${spieler.gefunden.spieler} Spieler)`
            : `Einzelpunkte: kein Kandidat liefert welche (${spieler.versucht.length} probiert)`
        );
      }
      const params = new URLSearchParams({ league: leagueId, live: teile.join(" · ") });
      return Response.redirect(new URL(`/liga/live?${params}`, request.url), 303);
    }
    return Response.json({ ...e, spieler });
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
