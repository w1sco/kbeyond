import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql, initSchema } from "@/lib/db";
import { euro, zeitpunkt } from "@/lib/format";
import { DiagnoseKopf, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

export default async function BonusDiag({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Login-Bonus" />;

  await initSchema();

  const zeilen = await sql`
    SELECT dt,
           (raw->>'day')::int AS tag,
           (raw->>'bn')::bigint AS betrag
    FROM events
    WHERE league_id = ${p.league} AND type = 22 AND raw ? 'bn'
    ORDER BY dt ASC`;

  // Laufende Summe statt für jede Zeile neu aufzuaddieren
  let kumuliert = 0;
  const mitSumme = zeilen.map((z) => {
    kumuliert += Number(z.betrag);
    return { ...z, kumuliert };
  });

  return (
    <main className="kb-seite kb-seite--schmal">
      <DiagnoseKopf
        titel="Login-Bonus"
        unter={`Liga ${p.league} · ${zeilen.length} Gutschriften · Summe ${euro(kumuliert)}`}
        leagueId={p.league}
      />

      <div className="kb-hinweis kb-hinweis--info">
        Der <strong>Streak-Tag</strong> zählt kontoweit über alle Ligen, der <strong>Betrag</strong>
        {" "}folgt einer ligaeigenen Staffelung ab dem Liga-Reset. Gleicher Tag kann deshalb in
        zwei Ligen unterschiedlich viel Geld bedeuten.
      </div>

      {zeilen.length === 0 ? (
        <p className="kb-info">Keine Bonus-Events gespeichert. Sie kommen nachts — das Feed-Fenster endet oft davor.</p>
      ) : (
        <div className="kb-tabellenrahmen">
          <table className="kb-tabelle kb-tabelle--schmal">
            <thead>
              <tr>
                <th className="kb-namensspalte">#</th>
                <th>Datum</th>
                <th>Streak-Tag</th>
                <th>Betrag</th>
                <th>kumuliert</th>
              </tr>
            </thead>
            <tbody>
              {mitSumme.map((z, i) => (
                <tr key={i} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                  <td className="kb-namensspalte">{i + 1}</td>
                  <td>{zeitpunkt(z.dt)}</td>
                  <td>{z.tag ?? "–"}</td>
                  <td>{euro(Number(z.betrag))}</td>
                  <td className="kb-gedaempft">{euro(z.kumuliert)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
