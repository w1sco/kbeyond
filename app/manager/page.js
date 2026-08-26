import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { probiere, DiagnoseKopf, Ergebnisse, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

// Die meisten dieser Pfade sind belegt NICHT vorhanden (404/405/500) und
// stehen hier als Nachweis: es gibt keinen Endpoint für Kontobewegungen
// pro Manager. Nicht nochmal suchen, siehe AGENTS.md.
const KANDIDATEN = (lid, uid) => [
  `/v4/leagues/${lid}/managers/${uid}/dashboard`,
  `/v4/leagues/${lid}/managers/${uid}/squad`,
  `/v4/leagues/${lid}/managers/${uid}/performance`,
  `/v4/leagues/${lid}/managers/${uid}/transfers`,
  `/v4/leagues/${lid}/managers/${uid}/activities`,
  `/v4/leagues/${lid}/managers/${uid}/balance`,
  `/v4/leagues/${lid}/managers/${uid}`,
  `/v4/leagues/${lid}/users/${uid}/dashboard`,
  `/v4/leagues/${lid}/users/${uid}/activities`,
  `/v4/leagues/${lid}/users/${uid}/transfers`,
  `/v4/leagues/${lid}/users/${uid}`,
  `/v4/leagues/${lid}/activitiesFeed?start=0&max=30&uid=${uid}`,
  `/v4/leagues/${lid}/finances`,
  `/v4/leagues/${lid}/budget`,
];

export default async function ManagerDiag({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Manager-Diagnose" />;
  if (!p.uid) {
    return (
      <main className="kb-seite kb-seite--schmal">
        <DiagnoseKopf titel="Manager-Diagnose" leagueId={p.league} />
        <div className="kb-hinweis kb-hinweis--warn">
          Diese Seite braucht zusätzlich eine Manager-ID: <code>?league={p.league}&amp;uid=…</code>
        </div>
      </main>
    );
  }

  const ergebnisse = await probiere(KANDIDATEN(p.league, p.uid), token);

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Manager-Diagnose"
        unter={`Liga ${p.league} · Manager-ID ${p.uid}`}
        leagueId={p.league}
      />
      <div className="kb-hinweis kb-hinweis--info">
        Die meisten dieser Pfade sind belegt nicht vorhanden. Sie stehen hier als Nachweis,
        dass es keinen Endpoint für Kontobewegungen pro Manager gibt.
      </div>
      <Ergebnisse ergebnisse={ergebnisse} />
    </main>
  );
}
