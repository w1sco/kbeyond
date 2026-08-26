import { cookies } from "next/headers";
import { kbFetch } from "@/lib/kickbase";
import { pruefeApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Selbstzuordnung: der Nutzer sagt, welcher Manager er in dieser Liga ist.
// Der Name wird gegen das Ranking geprüft – sonst ließe sich ein beliebiger
// Wert ins Cookie schreiben.
export async function POST(request) {
  const token = (await cookies()).get("kb_token")?.value;
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");
  const name = searchParams.get("name");

  const abgelehnt = await pruefeApi(request, leagueId, token);
  if (abgelehnt) return abgelehnt;

  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const bekannt = (ranking.us ?? []).some((m) => m.n === name);
  if (!bekannt) {
    return Response.json({ error: "Manager gibt es in dieser Liga nicht" }, { status: 400 });
  }

  (await cookies()).set("kb_name", name, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  return Response.redirect(new URL(`/liga?league=${leagueId}`, request.url), 303);
}
