import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kbFetch } from "@/lib/kickbase";

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
  const leagueId = p.league ?? "1762865";
  const tid = p.tid ?? "7";

  const ergebnisse = [];
  for (const pfad of KANDIDATEN(leagueId, tid)) {
    try {
      const daten = await kbFetch(pfad, token);
      const text = JSON.stringify(daten);
      const ids = [...text.matchAll(/"(?:pi|i)":"(\d+)"/g)].map((m) => m[1]);
      ergebnisse.push({
        pfad,
        ok: true,
        groesse: text.length,
        idAnzahl: new Set(ids).size,
        vorschau: text.slice(0, 1200),
      });
    } catch (e) {
      ergebnisse.push({ pfad, ok: false, fehler: e.message });
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Team-Diagnose · Team {tid}</h1>
      <p style={{ fontSize: 12, color: "#64748b" }}>
        Gesucht: ein Endpoint mit möglichst vielen eindeutigen Spieler-IDs.
      </p>
      {ergebnisse.map((r) => (
        <section key={r.pfad} style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 13, fontFamily: "monospace" }}>
            {r.pfad} → {r.ok ? `OK · ${r.groesse} Zeichen · ${r.idAnzahl} IDs` : r.fehler}
          </h2>
          {r.ok && (
            <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 8, fontSize: 11, overflowX: "auto", maxHeight: 220 }}>
              {r.vorschau}
            </pre>
          )}
        </section>
      ))}
    </main>
  );
}
