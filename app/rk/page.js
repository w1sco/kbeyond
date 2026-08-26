import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql, initSchema } from "@/lib/db";
import { euro, zeitpunkt } from "@/lib/format";
import { DiagnoseKopf, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

function Transfertabelle({ zeilen }) {
  return (
    <div className="kb-tabellenrahmen">
      <table className="kb-tabelle kb-tabelle--schmal">
        <thead>
          <tr>
            <th className="kb-namensspalte">Spieler</th>
            <th>Käufer</th>
            <th>Verkäufer</th>
            <th>Preis</th>
            <th>Datum</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((r, i) => (
            <tr key={r.id ?? i} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
              <td className="kb-namensspalte">
                {r.player_name} <span className="kb-leise">#{r.player_id}</span>
              </td>
              <td>{r.buyer ?? <span className="kb-gedaempft">Kickbase</span>}</td>
              <td>{r.seller ?? <span className="kb-gedaempft">Kickbase</span>}</td>
              <td>{euro(Number(r.price))}</td>
              <td>{zeitpunkt(r.dt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function RK({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Rekonstruierte Transfers" />;

  await initSchema();

  const rk = await sql`
    SELECT id, dt, buyer, seller, price, player_id, player_name
    FROM events
    WHERE league_id = ${p.league} AND id LIKE 'rk\_%'
    ORDER BY dt DESC`;

  // Gibt es zu jedem rk-Eintrag einen Feed-Eintrag für denselben Spieler?
  const ids = rk.map((r) => r.player_id);
  const feed = ids.length
    ? await sql`
        SELECT id, dt, buyer, seller, price, player_id, player_name
        FROM events
        WHERE league_id = ${p.league} AND type = 15
          AND id NOT LIKE 'rk\_%'
          AND player_id = ANY(${ids})
        ORDER BY dt DESC`
    : [];

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Rekonstruierte Transfers"
        unter={`Liga ${p.league} · ${rk.length} Einträge aus der Spielerhistorie`}
        leagueId={p.league}
      />

      <div className="kb-hinweis kb-hinweis--info">
        Rekonstruiert wird nur, was <strong>vor</strong> dem ältesten echten Feed-Eintrag liegt.
        Diese Zeitgrenze ist die einzige Duplikatvermeidung — ein früherer Ansatz über
        Fingerabdrücke hat 88 Duplikate erzeugt.
      </div>

      {rk.length === 0 ? (
        <p className="kb-info">Noch nichts rekonstruiert.</p>
      ) : (
        <Transfertabelle zeilen={rk} />
      )}

      <h2 className="kb-abschnitt-titel" style={{ marginTop: 28 }}>
        Feed-Einträge zu denselben Spielern
      </h2>
      <p className="kb-info">
        Zum Vergleich — stimmen Preis und Zeit überein, war es ein Duplikat.
      </p>
      {feed.length === 0 ? (
        <p className="kb-info">Keine Überschneidung. So soll es sein.</p>
      ) : (
        <Transfertabelle zeilen={feed} />
      )}
    </main>
  );
}
