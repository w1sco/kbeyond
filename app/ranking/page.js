import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { probiere, DiagnoseKopf, Ergebnisse, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

const KANDIDATEN = (id) => [
  `/v4/leagues/${id}/ranking`,
  `/v4/leagues/${id}/overview`,
  `/v4/leagues/${id}/me`,
  `/v4/leagues/${id}/managers`,
];

export default async function Ranking({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Ranking-Diagnose" />;

  const ergebnisse = await probiere(KANDIDATEN(p.league), token);

  return (
    <main className="kb-seite">
      <DiagnoseKopf titel="Ranking-Diagnose" unter={`Liga ${p.league}`} leagueId={p.league} />
      <Ergebnisse ergebnisse={ergebnisse} />
    </main>
  );
}
