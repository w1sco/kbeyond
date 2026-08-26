import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql, initSchema } from "@/lib/db";
import { euro } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BonusDiag({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  const leagueId = p.league ?? "6423644";

  await initSchema();

  const zeilen = await sql`
    SELECT dt,
           (raw->>'day')::int AS tag,
           (raw->>'bn')::bigint AS betrag
    FROM events
    WHERE league_id = ${leagueId} AND type = 22 AND raw ? 'bn'
    ORDER BY dt ASC`;

  const summe = zeilen.reduce((s, z) => s + Number(z.betrag), 0);

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20 }}>Login-Bonus · Liga {leagueId}</h1>
      <p style={{ color: "#64748b", fontSize: 13 }}>
        {zeilen.length} Gutschriften · Summe {euro(summe)}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 16 }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Datum</th>
            <th style={thR}>Streak-Tag</th>
            <th style={thR}>Betrag</th>
            <th style={thR}>kumuliert</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z, i) => {
            const kum = zeilen.slice(0, i + 1).reduce((s, x) => s + Number(x.betrag), 0);
            return (
              <tr key={i}>
                <td style={td}>{i + 1}</td>
                <td style={td}>
                  {new Date(z.dt).toLocaleString("de-DE", {
                    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                  })}
                </td>
                <td style={tdR}>{z.tag ?? "–"}</td>
                <td style={tdR}>{euro(Number(z.betrag))}</td>
                <td style={{ ...tdR, color: "#94a3b8" }}>{euro(kum)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}

const th = { textAlign: "left", padding: "7px 9px", borderBottom: "2px solid #e2e8f0", fontSize: 11, textTransform: "uppercase", color: "#64748b" };
const thR = { ...th, textAlign: "right" };
const td = { padding: "7px 9px", borderBottom: "1px solid #f1f5f9" };
const tdR = { ...td, textAlign: "right" };
