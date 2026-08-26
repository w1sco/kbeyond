import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kbFetch } from "@/lib/kickbase";

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
  const leagueId = p.league ?? "1762865";

  const ergebnisse = [];
  for (const pfad of KANDIDATEN(leagueId)) {
    try {
      const daten = await kbFetch(pfad, token);
      const text = JSON.stringify(daten);
      ergebnisse.push({
        pfad,
        ok: true,
        groesse: text.length,
        vorschau: text.slice(0, 2500),
      });
    } catch (e) {
      ergebnisse.push({ pfad, ok: false, fehler: e.message });
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Spielerpool-Diagnose</h1>
      {ergebnisse.map((r) => (
        <section key={r.pfad} style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 13, fontFamily: "monospace" }}>
            {r.pfad} → {r.ok ? `OK (${r.groesse} Zeichen)` : r.fehler}
          </h2>
          {r.ok && (
            <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 8, fontSize: 11, overflowX: "auto", maxHeight: 300 }}>
              {r.vorschau}
            </pre>
          )}
        </section>
      ))}
    </main>
  );
}
