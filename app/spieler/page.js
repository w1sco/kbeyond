import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { probiere, DiagnoseKopf, Ergebnisse, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

const KANDIDATEN = (lid, pid) => [
  `/v4/leagues/${lid}/players/${pid}/transferHistory`,
  `/v4/leagues/${lid}/players/${pid}/transfers`,
  `/v4/leagues/${lid}/players/${pid}`,
  `/v4/leagues/${lid}/players/${pid}/marketValue`,
  `/v4/leagues/${lid}/players/${pid}/stats`,
  `/v4/leagues/${lid}/managers/${pid}/squad`,
  `/v4/leagues/${lid}/managers/${pid}/dashboard`,
];

export default async function SpielerDiag({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Spieler-Diagnose" />;
  const pid = p.pid ?? "72";

  const ergebnisse = await probiere(KANDIDATEN(p.league, pid), token);

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Spieler-Diagnose"
        unter={`Liga ${p.league} · Spieler-ID ${pid} · andere ID über ?pid=`}
        leagueId={p.league}
      />
      <Ergebnisse ergebnisse={ergebnisse} />
    </main>
  );
}
