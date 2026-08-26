import { cookies } from "next/headers";
import { initSchema } from "@/lib/db";
import { importiere } from "@/lib/importer";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) return Response.json({ error: "nicht angemeldet" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");
  if (!leagueId) return Response.json({ error: "league fehlt" }, { status: 400 });

  const voll = searchParams.get("voll") === "1";

  try {
    await initSchema();
    const ergebnis = await importiere(leagueId, token, {
      vollstaendig: voll,
      maxSeiten: Number(searchParams.get("seiten") ?? 40),
    });
    return Response.json(ergebnis);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
