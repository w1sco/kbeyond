import { sitzung } from "@/lib/auth";
import { probiere, DiagnoseKopf, Ergebnisse, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

const KANDIDATEN = (id) => [
  `/v4/leagues/${id}/ranking`,
  `/v4/leagues/${id}/overview`,
  `/v4/leagues/${id}/me`,
  `/v4/leagues/${id}/managers`,
];

export default async function Ranking({ searchParams }) {
  // sitzung() statt nur das Cookie: Erst sie prüft die Freigabeliste.
  // Ohne sie kam jedes Liga-Mitglied mit Kickbase-Konto hier herein.
  const { token } = await sitzung();

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
