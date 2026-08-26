import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { sql, initSchema } from "@/lib/db";
import { euro, zeitpunkt } from "@/lib/format";
import { DiagnoseKopf, LigaFehlt } from "../_diagnose/Endpunkte";
import { verlangeLiga } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Diese Seite geht über die Namen in den Events, nicht über das Ranking.
// Damit erwischt sie auch Manager, die die Liga verlassen haben – die
// reguläre Managerseite unter /liga/manager/{id} kennt nur aktuelle.
export default async function Detail({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Transfers nach Name" />;

  await verlangeLiga(p.league, token);
  await initSchema();

  if (!p.name) {
    const namen = await sql`
      SELECT DISTINCT buyer AS n FROM events
      WHERE league_id = ${p.league} AND buyer IS NOT NULL
      UNION
      SELECT DISTINCT seller AS n FROM events
      WHERE league_id = ${p.league} AND seller IS NOT NULL
      ORDER BY n`;
    return (
      <main className="kb-seite">
        <DiagnoseKopf
          titel="Transfers nach Name"
          unter="Alle Namen, die in den gespeicherten Events vorkommen"
          leagueId={p.league}
        />
        <div className="kb-kacheln">
          {namen.map((x) => (
            <Link
              key={x.n}
              href={`/manager-detail?league=${p.league}&name=${encodeURIComponent(x.n)}`}
              className="kb-kachel"
            >
              {x.n}
            </Link>
          ))}
        </div>
      </main>
    );
  }

  const zeilen = await sql`
    SELECT dt, buyer, seller, price, player_name, id
    FROM events
    WHERE league_id = ${p.league} AND type = 15
      AND (buyer = ${p.name} OR seller = ${p.name})
    ORDER BY dt DESC`;

  const kaeufe = zeilen.filter((z) => z.buyer === p.name);
  const verkaeufe = zeilen.filter((z) => z.seller === p.name);
  const sumK = kaeufe.reduce((s, z) => s + Number(z.price), 0);
  const sumV = verkaeufe.reduce((s, z) => s + Number(z.price), 0);

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel={p.name}
        unter={`${kaeufe.length} Käufe (${euro(sumK)}) · ${verkaeufe.length} Verkäufe (${euro(sumV)}) · Saldo ${euro(sumV - sumK)} · Kader rechnerisch ${kaeufe.length - verkaeufe.length}`}
        leagueId={p.league}
      />

      <div className="kb-tabellenrahmen">
        <table className="kb-tabelle kb-tabelle--schmal">
          <thead>
            <tr>
              <th className="kb-namensspalte">Spieler</th>
              <th>Richtung</th>
              <th>Preis</th>
              <th>Datum</th>
              <th>Quelle</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z, i) => {
              const kauf = z.buyer === p.name;
              return (
                <tr key={z.id} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                  <td className="kb-namensspalte">{z.player_name ?? "–"}</td>
                  <td>{kauf ? "Kauf" : "Verkauf"}</td>
                  <td className={kauf ? "kb-minus" : undefined}>
                    {kauf ? "−" : "+"}{euro(Number(z.price))}
                  </td>
                  <td>{zeitpunkt(z.dt)}</td>
                  <td className="kb-gedaempft">
                    {String(z.id).startsWith("rk_") ? "rekonstruiert" : "Feed"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
