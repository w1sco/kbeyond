import { cookies } from "next/headers";
import { pruefeApi, sitzung } from "@/lib/auth";
import { initSchema } from "@/lib/db";
import { kbFetch } from "@/lib/kickbase";
import { holeMitspieler } from "@/lib/mitspieler";
import {
  sucheLivePfad, sucheSpielerPunkte, holeLivestand, holeSpielerPunkte,
  speichereSpielerPunkte, bekannterLivePfad,
} from "@/lib/liveabruf";

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

    // Zweiter Modus: die Einzelpunkte über den bereits bewiesenen Pfad
    // holen. Ein Aufruf je Manager — deshalb nur auf Klick.
    if (searchParams.get("punkte") === "1") {
      const merk = await bekannterLivePfad();
      const stand = await holeLivestand(leagueId, token, ids, new Map());
      const geholt = merk?.spielerPfad
        ? await holeSpielerPunkte(leagueId, token, ids, stand?.aufstellung ?? new Map())
        : null;
      if (geholt?.size) await speichereSpielerPunkte(leagueId, geholt);

      const text = geholt?.size
        ? `Einzelpunkte geholt: ${[...geholt.values()].reduce((n, m) => n + m.size, 0)} Spieler bei ${geholt.size} Managern`
        : merk?.spielerPfad
          ? "Einzelpunkte: der gemerkte Pfad liefert gerade nichts"
          : "Einzelpunkte: erst den Endpunkt suchen";

      if (zurueck) {
        const params = new URLSearchParams({ league: leagueId, live: text });
        return Response.redirect(new URL(`/liga/live?${params}`, request.url), 303);
      }
      return Response.json({ text });
    }

    const e = await sucheLivePfad(leagueId, token, ids, uid);

    // Ist der Manager-Endpunkt gefunden, gleich weitersuchen: Er liefert
    // die Elf (`lp`), aber keine Punkte je Spieler. Die echten IDs aus
    // `lp` sind dabei der Anker — deshalb erst jetzt und nicht vorher.
    let spieler = null;
    if (e.gefunden) {
      const stand = await holeLivestand(leagueId, token, ids, new Map());
      if (!stand?.spieler?.size) {
        // Geprüft wird an **einem** Manager, dessen Spieltagssumme wir
        // kennen: Ein Feld, dessen Summe über seine Elf genau diese Zahl
        // ergibt, ist bewiesen. Das kostet einen Aufruf je Kandidat.
        const kandidat =
          [...(stand?.aufstellung ?? new Map())].find(
            ([mid, elf]) => elf.length > 0 && Number(stand.punkte.get(mid)) > 0
          ) ?? null;
        if (kandidat) {
          const [mid, elf] = kandidat;
          spieler = await sucheSpielerPunkte(
            leagueId, token, mid, elf, Number(stand.punkte.get(mid))
          );
        } else {
          spieler = { gefunden: null, versucht: [], grund: "keine Elf in der Antwort" };
        }
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
            ? `Einzelpunkte gefunden: ${spieler.gefunden.pfad}, Feld ${spieler.gefunden.feld} — Summe der Elf ${spieler.gefunden.summe} = ${spieler.gefunden.soll}`
            : `Einzelpunkte: kein Feld summiert auf die Spieltagspunkte (${spieler.versucht.length} Kandidaten). Nächste Werte: ` +
              (spieler.versucht
                .flatMap((v) => (v.geprueft ?? []).slice(0, 3).map((g) => `${g.feld}=${g.summe}`))
                .slice(0, 6)
                .join(", ") || spieler.grund || "nichts gefunden")
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
