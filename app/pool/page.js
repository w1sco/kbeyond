import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { probiere, DiagnoseKopf, Ergebnisse, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

const KANDIDATEN = (lid) => [
  `/v4/competitions/1/players`,
  `/v4/competitions/1/playercenter`,
  `/v4/competitions/1/table`,
  `/v4/competitions/1/teams/7/players`,
  `/v4/leagues/${lid}/squad`,
  `/v4/leagues/${lid}/teamcenter`,
];

export default async function Pool({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Spielerpool-Diagnose" />;

  const ergebnisse = (await probiere(KANDIDATEN(p.league), token)).map((r) =>
    r.ok ? { ...r, hinweis: `${JSON.stringify(r.daten).length} Zeichen` } : r
  );

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Spielerpool-Diagnose"
        unter="Gesucht: eine Quelle für alle Bundesliga-Spieler"
        leagueId={p.league}
      />
      <Ergebnisse ergebnisse={ergebnisse} />
    </main>
  );
}
