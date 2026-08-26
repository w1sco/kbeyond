import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kbFetch } from "@/lib/kickbase";

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
  const leagueId = p.league ?? "6423644";

  const ergebnisse = [];
  for (const pfad of KANDIDATEN(leagueId)) {
    try {
      ergebnisse.push({ pfad, ok: true, daten: await kbFetch(pfad, token) });
    } catch (e) {
      ergebnisse.push({ pfad, ok: false, fehler: e.message });
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>Ranking-Diagnose · Liga {leagueId}</h1>
      {ergebnisse.map((r) => (
        <section key={r.pfad} style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 14, fontFamily: "monospace" }}>
            {r.pfad} → {r.ok ? "OK" : r.fehler}
          </h2>
          {r.ok && (
            <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 8, fontSize: 11, overflowX: "auto", maxHeight: 400 }}>
              {JSON.stringify(r.daten, null, 2)}
            </pre>
          )}
        </section>
      ))}
    </main>
  );
}
