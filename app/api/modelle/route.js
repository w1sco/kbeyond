import { holeModelle, ANBIETER } from "@/lib/anbieter";
import { cookies } from "next/headers";
import { pruefeApi, nutzerSchluessel } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Fragt den Anbieter, welche Modelle der Schlüssel benutzen darf. Eine fest
// verdrahtete Liste wäre in wenigen Monaten veraltet.
export async function POST(request) {
  const store = await cookies();
  const token = store.get("kb_token")?.value;
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");

  const abgelehnt = await pruefeApi(request, leagueId, token);
  if (abgelehnt) return abgelehnt;

  const { anbieter, schluessel } = await request.json().catch(() => ({}));
  if (!ANBIETER[anbieter]) {
    return Response.json({ error: "Unbekannter Anbieter" }, { status: 400 });
  }
  if (typeof schluessel !== "string" || schluessel.length < 10) {
    return Response.json({ error: "Kein API-Schlüssel übergeben" }, { status: 400 });
  }

  try {
    const modelle = await holeModelle(anbieter, schluessel);
    if (modelle.length === 0) {
      return Response.json({ error: "Der Schlüssel sieht gültig aus, liefert aber keine Modelle" }, { status: 502 });
    }
    return Response.json({ modelle, standard: ANBIETER[anbieter].standardModell });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}
