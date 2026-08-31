import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { euro, restzeit, normalisiereSpieler } from "@/lib/format";
import { holeLigen } from "@/lib/auth";



export const dynamic = "force-dynamic";

export default async function Markt({ searchParams }) {
  const store = await cookies();
  const token = store.get("kb_token")?.value;
  if (!token) redirect("/login");

  const params = await searchParams;
  const leagueId = params.league;

  if (!leagueId) {
    // Über holeLigen: Eine abgelaufene Sitzung führt damit zur Anmeldung
    // statt zu einem Serverfehler.
    const ligen = { it: await holeLigen(token) };
    return (
      <main className="kb-seite kb-seite--schmal">
        <h1 className="kb-titel">KBeyond</h1>
        <p className="kb-unter">Liga wählen</p>
        <div style={{ display: "grid", gap: 8 }}>
          {(ligen.it ?? []).map((l) => (
            <Link key={l.i} href={`/markt?league=${l.i}`} className="kb-kachel">
              <strong>{l.n}</strong>
              <span className="kb-leise">
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
      <main className="kb-seite kb-seite--schmal">
        <h1 className="kb-titel">Fehler</h1>
        <pre className="kb-roh">{fehler}</pre>
        <Link href="/markt" className="kb-zurueck">← Ligaauswahl</Link>
      </main>
    );
  }

  if (params.debug === "1") {
    return (
      <main className="kb-seite kb-seite--schmal">
        <h1 className="kb-titel">Debug</h1>
        <pre className="kb-roh">{JSON.stringify(daten, null, 2)}</pre>
      </main>
    );
  }

  const liste = daten.it ?? daten.items ?? daten.players ?? [];
  const spieler = liste.map(normalisiereSpieler);

  return (
    <main className="kb-seite kb-seite--schmal">
      <div className="kb-kopf">
        <div>
          <h1 className="kb-titel">Transfermarkt</h1>
          <p className="kb-unter">{spieler.length} Angebote</p>
        </div>
        <Link href={`/markt?league=${leagueId}&debug=1`} className="kb-zurueck">
          Rohdaten
        </Link>
      </div>

      <div className="kb-tabellenrahmen">
        <table className="kb-tabelle">
          <thead>
            <tr>
              <th>Spieler</th>
              <th>Pos</th>
              <th>Marktwert</th>
              <th>Preis</th>
              <th>Ø Punkte</th>
              <th>Läuft ab</th>
              <th>Von</th>
            </tr>
          </thead>
          <tbody>
            {spieler.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong></td>
                <td>{s.position}</td>
                <td>{euro(s.marktwert)}</td>
                <td>{euro(s.preis)}</td>
                <td>{s.schnitt ?? "–"}</td>
                <td>{restzeit(s.ablauf)}</td>
                <td className="kb-leise">{s.anbieter ?? "Kickbase"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {spieler.length === 0 && (
        <p className="kb-leise">
          Keine Einträge erkannt. Ruf die Seite mit <code>&amp;debug=1</code> auf,
          um die Rohdaten zu sehen.
        </p>
      )}
    </main>
  );
}
