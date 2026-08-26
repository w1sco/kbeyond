import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kbFetch } from "@/lib/kickbase";

export default async function Markt({ searchParams }) {
  const store = await cookies();
  const token = store.get("kb_token")?.value;
  if (!token) redirect("/login");

  const params = await searchParams;
  const leagueId = params.league;
  if (!leagueId) {
    const leagues = await kbFetch("/v4/leagues/selection", token);
    return <pre>{JSON.stringify(leagues, null, 2)}</pre>;
  }

  const market = await kbFetch(`/v4/leagues/${leagueId}/market`, token);
  return <pre>{JSON.stringify(market, null, 2)}</pre>;
}
