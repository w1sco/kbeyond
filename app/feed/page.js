import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { probiere, DiagnoseKopf, Ergebnisse, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

const KANDIDATEN = (id, start, max) => [
  `/v4/leagues/${id}/activitiesFeed?start=${start}&max=${max}`,
  `/v4/leagues/${id}/activities?start=${start}&max=${max}`,
  `/v4/leagues/${id}/activitiesFeed`,
  `/v4/leagues/${id}/feed?start=${start}&max=${max}`,
];

export default async function Feed({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Feed-Diagnose" />;
  const start = p.start ?? "0";
  const max = p.max ?? "30";

  const ergebnisse = (await probiere(KANDIDATEN(p.league, start, max), token)).map((r) =>
    r.ok ? { ...r, hinweis: `${(r.daten.af ?? []).length} Einträge` } : r
  );

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Feed-Diagnose"
        unter={`Liga ${p.league} · start=${start} max=${max} · Fenster über ?start= und ?max= verschieben`}
        leagueId={p.league}
      />
      <div className="kb-hinweis kb-hinweis--info">
        Der Feed liefert nur die letzten ~670 Einträge. Ab <code>start=700</code> kommt eine
        leere Liste — das ist die Grenze, nicht ein Fehler.
      </div>
      <Ergebnisse ergebnisse={ergebnisse} />
    </main>
  );
}
