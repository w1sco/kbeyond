import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kbFetch } from "@/lib/kickbase";

export const dynamic = "force-dynamic";

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
  const leagueId = p.league ?? "1762865";
  const uid = p.uid ?? "1181911"; // Standard: deine eigene ID

  const ergebnisse = [];
  for (const pfad of KANDIDATEN(leagueId, uid)) {
    try {
      const daten = await kbFetch(pfad, token);
      const text = JSON.stringify(daten);
      ergebnisse.push({
        pfad,
        ok: true,
        groesse: text.length,
        // Hinweise auf Geldbewegungen
        hatAmt: text.includes('"amt"'),
        hatTrp: text.includes('"trp"'),
        hatBn: text.includes('"bn"'),
        vorschau: text.slice(0, 1500),
      });
    } catch (e) {
      ergebnisse.push({ pfad, ok: false, fehler: e.message });
    }
  }

  const treffer = ergebnisse.filter((r) => r.ok);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Manager-Diagnose</h1>
      <p style={{ fontSize: 13, color: "#64748b" }}>
        Liga {leagueId} · Manager-ID {uid} · {treffer.length} von {ergebnisse.length} Endpoints erreichbar
      </p>
      <p style={{ fontSize: 12, color: "#64748b" }}>
        Gesucht: ein Endpoint mit Kontobewegungen (Feld <code>amt</code>) über den Feed-Zeitraum hinaus.
      </p>

      {ergebnisse.map((r) => (
        <section key={r.pfad} style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 13, fontFamily: "monospace" }}>
            {r.pfad} → {r.ok ? `OK · ${r.groesse} Zeichen` : r.fehler}
            {r.ok && r.hatAmt && <span style={{ color: "#16a34a" }}> · enthält amt</span>}
            {r.ok && r.hatTrp && <span style={{ color: "#2563eb" }}> · enthält trp</span>}
            {r.ok && r.hatBn && <span style={{ color: "#7c3aed" }}> · enthält bn</span>}
          </h2>
          {r.ok && (
            <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 8, fontSize: 11, overflowX: "auto", maxHeight: 240 }}>
              {r.vorschau}
            </pre>
          )}
        </section>
      ))}
    </main>
  );
}
