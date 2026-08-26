import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kbFetch } from "@/lib/kickbase";

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
  const leagueId = p.league ?? "1762865";
  const pid = p.pid ?? "72";

  const ergebnisse = [];
  for (const pfad of KANDIDATEN(leagueId, pid)) {
    try {
      ergebnisse.push({ pfad, ok: true, daten: await kbFetch(pfad, token) });
    } catch (e) {
      ergebnisse.push({ pfad, ok: false, fehler: e.message });
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Spieler-Diagnose · Liga {leagueId} · ID {pid}</h1>
      {ergebnisse.map((r) => (
        <section key={r.pfad} style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 13, fontFamily: "monospace" }}>
            {r.pfad} → {r.ok ? "OK" : r.fehler}
          </h2>
          {r.ok && (
            <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 8, fontSize: 11, overflowX: "auto", maxHeight: 320 }}>
              {JSON.stringify(r.daten, null, 2)}
            </pre>
          )}
        </section>
      ))}
    </main>
  );
}
