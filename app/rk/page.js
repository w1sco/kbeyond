import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql, initSchema } from "@/lib/db";
import { euro } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RK({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  const leagueId = p.league ?? "6423644";

  await initSchema();

  const rk = await sql`
    SELECT id, dt, buyer, seller, price, player_id, player_name
    FROM events
    WHERE league_id = ${leagueId} AND id LIKE 'rk\_%'
    ORDER BY dt DESC`;

  // Gibt es zu jedem rk-Eintrag einen Feed-Eintrag für denselben Spieler?
  const ids = rk.map((r) => r.player_id);
  const feed = ids.length
    ? await sql`
        SELECT dt, buyer, seller, price, player_id, player_name
        FROM events
        WHERE league_id = ${leagueId} AND type = 15
          AND id NOT LIKE 'rk\_%'
          AND player_id = ANY(${ids})
        ORDER BY dt DESC`
    : [];

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20 }}>Rekonstruierte Transfers · Liga {leagueId}</h1>
      <p style={{ fontSize: 13, color: "#64748b" }}>{rk.length} Einträge</p>

      <table style={t}>
        <thead>
          <tr>
            <th style={th}>Datum</th>
            <th style={th}>Spieler</th>
            <th style={th}>Käufer</th>
            <th style={th}>Verkäufer</th>
            <th style={thR}>Preis</th>
          </tr>
        </thead>
        <tbody>
          {rk.map((r) => (
            <tr key={r.id}>
              <td style={td}>{new Date(r.dt).toLocaleString("de-DE")}</td>
              <td style={td}>{r.player_name} <span style={{ color: "#94a3b8" }}>#{r.player_id}</span></td>
              <td style={td}>{r.buyer ?? <em style={{ color: "#94a3b8" }}>Kickbase</em>}</td>
              <td style={td}>{r.seller ?? <em style={{ color: "#94a3b8" }}>Kickbase</em>}</td>
              <td style={tdR}>{euro(Number(r.price))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, marginTop: 32 }}>Feed-Einträge zu denselben Spielern</h2>
      <p style={{ fontSize: 12, color: "#64748b" }}>
        Zum Vergleich – stimmen Preis und Zeit überein, war es ein Duplikat.
      </p>
      <table style={t}>
        <thead>
          <tr>
            <th style={th}>Datum</th>
            <th style={th}>Spieler</th>
            <th style={th}>Käufer</th>
            <th style={th}>Verkäufer</th>
            <th style={thR}>Preis</th>
          </tr>
        </thead>
        <tbody>
          {feed.map((r, i) => (
            <tr key={i}>
              <td style={td}>{new Date(r.dt).toLocaleString("de-DE")}</td>
              <td style={td}>{r.player_name} <span style={{ color: "#94a3b8" }}>#{r.player_id}</span></td>
              <td style={td}>{r.buyer ?? <em style={{ color: "#94a3b8" }}>Kickbase</em>}</td>
              <td style={td}>{r.seller ?? <em style={{ color: "#94a3b8" }}>Kickbase</em>}</td>
              <td style={tdR}>{euro(Number(r.price))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

const t = { width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 12 };
const th = { textAlign: "left", padding: "7px 9px", borderBottom: "2px solid #e2e8f0", fontSize: 11, textTransform: "uppercase", color: "#64748b" };
const thR = { ...th, textAlign: "right" };
const td = { padding: "7px 9px", borderBottom: "1px solid #f1f5f9" };
const tdR = { ...td, textAlign: "right" };
