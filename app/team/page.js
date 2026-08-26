import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { probiere, DiagnoseKopf, Ergebnisse, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

const KANDIDATEN = (lid, tid) => [
  `/v4/competitions/1/teams/${tid}/teamcenter`,
  `/v4/competitions/1/teams/${tid}/teamprofile`,
  `/v4/competitions/1/teams/${tid}`,
  `/v4/leagues/${lid}/teams/${tid}/teamcenter`,
  `/v4/leagues/${lid}/teams/${tid}/players`,
  `/v4/competitions/1/players?tid=${tid}`,
  `/v4/competitions/1/players?start=0&max=500`,
];

export default async function TeamDiag({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Team-Diagnose" />;
  const tid = p.tid ?? "7";

  const ergebnisse = (await probiere(KANDIDATEN(p.league, tid), token)).map((r) => {
    if (!r.ok) return r;
    const text = JSON.stringify(r.daten);
    const ids = new Set([...text.matchAll(/"(?:pi|i)":"(\d+)"/g)].map((m) => m[1]));
    return { ...r, hinweis: `${text.length} Zeichen · ${ids.size} Spieler-IDs` };
  });

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Team-Diagnose"
        unter={`Liga ${p.league} · Team ${tid} · anderes Team über ?tid= · gesucht: ein Endpoint mit möglichst vielen eindeutigen Spieler-IDs`}
        leagueId={p.league}
      />
      <Ergebnisse ergebnisse={ergebnisse} />
    </main>
  );
}
