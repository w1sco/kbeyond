import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql, initSchema } from "@/lib/db";
import { euro } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Detail({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  const leagueId = p.league ?? "6423644";
  const name = p.name;

  await initSchema();

  if (!name) {
    const namen = await sql`
      SELECT DISTINCT buyer AS n FROM events
      WHERE league_id = ${leagueId} AND buyer IS NOT NULL
      UNION
      SELECT DISTINCT seller AS n FROM events
      WHERE league_id = ${leagueId} AND seller IS NOT NULL
      ORDER BY n`;
    return (
      <main style={S.main}>
        <h1 style={S.h1}>Manager wählen</h1>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 8 }}>
          {namen.map((x) => (
            <a key={x.n} href={`/manager-detail?league=${leagueId}&name=${encodeURIComponent(x.n)}`} style={S.card}>
              {x.n}
            </a>
          ))}
        </div>
      </main>
    );
  }

  const zeilen = await sql`
    SELECT dt, buyer, seller, price, player_name, id
    FROM events
    WHERE league_id = ${leagueId} AND type = 15
      AND (buyer = ${name} OR seller = ${name})
    ORDER BY dt DESC`;

  const kaeufe = zeilen.filter((z) => z.buyer === name);
  const verkaeufe = zeilen.filter((z) => z.seller === name);
  const sumK = kaeufe.reduce((s, z) => s + Number(z.price), 0);
  const sumV = verkaeufe.reduce((s, z) => s + Number(z.price), 0);

  return (
    <main style={S.main}>
      <a href={`/liga?league=${leagueId}`} style={S.back}>← zur Liga</a>
      <h1 style={S.h1}>{name}</h1>
      <p style={S.sub}>
        {kaeufe.length} Käufe ({euro(sumK)}) · {verkaeufe.length} Verkäufe ({euro(sumV)}) ·
        Saldo {euro(sumV - sumK)}
      </p>

      <table style={S.t}>
        <thead>
          <tr>
            <th style={S.th}>Datum</th>
            <th style={S.th}>Spieler</th>
            <th style={S.th}>Richtung</th>
            <th style={S.thR}>Preis</th>
            <th style={S.th}>Quelle</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => {
            const kauf = z.buyer === name;
            return (
              <tr key={z.id}>
                <td style={S.td}>{new Date(z.dt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td style={S.td}>{z.player_name ?? "–"}</td>
                <td style={{ ...S.td, color: kauf ? "#dc2626" : "#16a34a" }}>
                  {kauf ? "Kauf" : "Verkauf"}
                </td>
                <td style={S.tdR}>{euro(Number(z.price))}</td>
                <td style={{ ...S.td, color: "#94a3b8", fontSize: 11 }}>
                  {String(z.id).startsWith("rk_") ? "rekonstruiert" : "Feed"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}

const S = {
  main: { maxWidth: 800, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" },
  back: { fontSize: 13, color: "#2563eb", textDecoration: "none" },
  h1: { fontSize: 22, margin: "10px 0 4px" },
  sub: { color: "#64748b", fontSize: 13, marginBottom: 18 },
  card: { padding: 12, border: "1px solid #e2e8f0", borderRadius: 8, textDecoration: "none", color: "inherit", fontSize: 14 },
  t: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "8px 9px", borderBottom: "2px solid #e2e8f0", fontSize: 11, textTransform: "uppercase", color: "#64748b" },
  thR: { textAlign: "right", padding: "8px 9px", borderBottom: "2px solid #e2e8f0", fontSize: 11, textTransform: "uppercase", color: "#64748b" },
  td: { padding: "8px 9px", borderBottom: "1px solid #f1f5f9" },
  tdR: { padding: "8px 9px", borderBottom: "1px solid #f1f5f9", textAlign: "right" },
};
