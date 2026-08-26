import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { euro, restzeit, normalisiereSpieler } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Markt({ searchParams }) {
  const store = await cookies();
  const token = store.get("kb_token")?.value;
  if (!token) redirect("/login");

  const params = await searchParams;
  const leagueId = params.league;

  if (!leagueId) {
    const ligen = await kbFetch("/v4/leagues/selection", token);
    return (
      <main style={S.main}>
        <h1 style={S.h1}>KBeyond</h1>
        <p style={S.sub}>Liga wählen</p>
        <div style={{ display: "grid", gap: 8 }}>
          {(ligen.it ?? []).map((l) => (
            <Link key={l.i} href={`/markt?league=${l.i}`} style={S.ligaCard}>
              <strong>{l.n}</strong>
              <span style={S.muted}>
                Budget {euro(l.b)} · Teamwert {euro(l.tv)}
              </span>
            </Link>
          ))}
        </div>
      </main>
    );
  }

  let daten, fehler = null;
  try {
    daten = await kbFetch(`/v4/leagues/${leagueId}/market`, token);
  } catch (e) {
    fehler = e.message;
  }

  if (fehler) {
    return (
      <main style={S.main}>
        <h1 style={S.h1}>Fehler</h1>
        <pre style={S.pre}>{fehler}</pre>
        <Link href="/markt" style={S.link}>← Ligaauswahl</Link>
      </main>
    );
  }

  if (params.debug === "1") {
    return (
      <main style={S.main}>
        <h1 style={S.h1}>Debug</h1>
        <pre style={S.pre}>{JSON.stringify(daten, null, 2)}</pre>
      </main>
    );
  }

  const liste = daten.it ?? daten.items ?? daten.players ?? [];
  const spieler = liste.map(normalisiereSpieler);

  return (
    <main style={S.main}>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>Transfermarkt</h1>
          <p style={S.sub}>{spieler.length} Angebote</p>
        </div>
        <Link href={`/markt?league=${leagueId}&debug=1`} style={S.link}>
          Rohdaten
        </Link>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Spieler</th>
              <th style={S.th}>Pos</th>
              <th style={{ ...S.th, textAlign: "right" }}>Marktwert</th>
              <th style={{ ...S.th, textAlign: "right" }}>Preis</th>
              <th style={{ ...S.th, textAlign: "right" }}>Ø Punkte</th>
              <th style={{ ...S.th, textAlign: "right" }}>Läuft ab</th>
              <th style={S.th}>Von</th>
            </tr>
          </thead>
          <tbody>
            {spieler.map((s) => (
              <tr key={s.id}>
                <td style={S.td}><strong>{s.name}</strong></td>
                <td style={S.td}>{s.position}</td>
                <td style={{ ...S.td, textAlign: "right" }}>{euro(s.marktwert)}</td>
                <td style={{ ...S.td, textAlign: "right" }}>{euro(s.preis)}</td>
                <td style={{ ...S.td, textAlign: "right" }}>{s.schnitt ?? "–"}</td>
                <td style={{ ...S.td, textAlign: "right" }}>{restzeit(s.ablauf)}</td>
                <td style={{ ...S.td, color: "#64748b" }}>{s.anbieter ?? "Kickbase"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {spieler.length === 0 && (
        <p style={S.muted}>
          Keine Einträge erkannt. Ruf die Seite mit <code>&amp;debug=1</code> auf,
          um die Rohdaten zu sehen.
        </p>
      )}
    </main>
  );
}

const S = {
  main: { maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 },
  h1: { fontSize: 26, margin: 0 },
  sub: { color: "#64748b", margin: "4px 0 0", fontSize: 14 },
  muted: { color: "#64748b", fontSize: 13 },
  link: { color: "#2563eb", fontSize: 13, textDecoration: "none" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e2e8f0", fontSize: 12, textTransform: "uppercase", color: "#64748b" },
  td: { padding: "10px", borderBottom: "1px solid #f1f5f9" },
  ligaCard: { display: "flex", flexDirection: "column", gap: 2, padding: 14, border: "1px solid #e2e8f0", borderRadius: 8, textDecoration: "none", color: "inherit" },
  pre: { background: "#f8fafc", padding: 14, borderRadius: 8, fontSize: 12, overflowX: "auto" },
};
