import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sql, initSchema } from "@/lib/db";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { findeWertreihe } from "@/lib/marktwerte";
import { DiagnoseKopf, LigaFehlt } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

// Wo steckt die Marktwert-Historie eines Spielers?
//
// Die Aufschlags-Rechnung braucht den Marktwert zum Kaufzeitpunkt. Welcher
// Endpunkt ihn liefert, ist unbelegt — diese Seite probiert die Kandidaten
// durch und sagt für jeden, ob sich eine Reihe aus Datum und Wert darin
// finden lässt. Erst wenn das feststeht, wird implementiert.
const KANDIDATEN = (lid, pid) => [
  `/v4/leagues/${lid}/players/${pid}/marketValue`,
  `/v4/leagues/${lid}/players/${pid}/marketvalue`,
  `/v4/leagues/${lid}/players/${pid}/marketValues`,
  `/v4/leagues/${lid}/players/${pid}/mv`,
  `/v4/leagues/${lid}/players/${pid}/marketValueHistory`,
  `/v4/leagues/${lid}/players/${pid}/stats`,
  `/v4/leagues/${lid}/players/${pid}/performance`,
  `/v4/leagues/${lid}/players/${pid}`,
  `/v4/competitions/1/players/${pid}/marketvalue`,
  `/v4/competitions/1/players/${pid}/marketValue`,
  `/v4/competitions/1/players/${pid}`,
  `/v4/players/${pid}/marketvalue`,
  `/v4/players/${pid}`,
];

export default async function MarktwertDiagnose({ searchParams }) {
  const { token } = await sitzung();
  const p = await searchParams;
  if (!p.league) return <LigaFehlt titel="Marktwert-Diagnose" />;
  await verlangeLiga(p.league, token);
  await initSchema();

  // Ohne pid einen Spieler vorschlagen, der wirklich gekauft wurde
  if (!p.pid) {
    const vorschlaege = await sql`
      SELECT DISTINCT player_id, player_name FROM events
      WHERE league_id = ${p.league} AND type = 15 AND buyer IS NOT NULL
        AND player_id IS NOT NULL AND player_name IS NOT NULL
      ORDER BY player_name LIMIT 24`;
    return (
      <main className="kb-seite">
        <DiagnoseKopf
          titel="Marktwert-Diagnose"
          unter="Spieler wählen — gesucht wird, welcher Endpunkt seine Marktwert-Historie liefert"
          leagueId={p.league}
        />
        <div className="kb-kacheln">
          {vorschlaege.map((s) => (
            <Link
              key={s.player_id}
              href={`/marktwert?league=${p.league}&pid=${s.player_id}`}
              className="kb-kachel"
            >
              {s.player_name}
              <span className="kb-leise">#{s.player_id}</span>
            </Link>
          ))}
        </div>
      </main>
    );
  }

  const ergebnisse = [];
  for (const pfad of KANDIDATEN(p.league, p.pid)) {
    try {
      const daten = await kbFetch(pfad, token);
      const reihe = findeWertreihe(daten);
      ergebnisse.push({
        pfad,
        ok: true,
        schluessel: Object.keys(daten ?? {}).join(", ") || "(keine)",
        treffer: reihe.length,
        erster: reihe[0] ?? null,
        letzter: reihe[reihe.length - 1] ?? null,
        roh: JSON.stringify(daten).slice(0, 1200),
      });
    } catch (e) {
      ergebnisse.push({ pfad, ok: false, fehler: e.message });
    }
  }

  const brauchbar = ergebnisse.filter((r) => r.ok && r.treffer > 0);

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Marktwert-Diagnose"
        unter={`Liga ${p.league} · Spieler ${p.pid} · ${ergebnisse.filter((r) => r.ok).length} von ${ergebnisse.length} Endpunkten erreichbar`}
        leagueId={p.league}
      />

      <div className={`kb-hinweis ${brauchbar.length ? "kb-hinweis--gut" : "kb-hinweis--warn"}`}>
        {brauchbar.length
          ? `Reihe gefunden bei: ${brauchbar.map((r) => r.pfad).join(", ")}`
          : "Kein Endpunkt liefert eine erkennbare Reihe aus Datum und Wert. Die Rohdaten unten zeigen, was stattdessen kommt."}
      </div>

      {ergebnisse.map((r) => (
        <section key={r.pfad} className="kb-karte">
          <h2 className="kb-pfad">
            <span className={r.ok ? "kb-marke--exakt" : "kb-minus"}>{r.ok ? "OK" : r.fehler}</span>{" "}
            {r.pfad}
            {r.ok && (
              <span className="kb-leise">
                {" "}· {r.treffer} Wertepunkte · Felder: {r.schluessel}
              </span>
            )}
          </h2>
          {r.ok && r.treffer > 0 && (
            <p className="kb-info">
              {r.erster.tag.toISOString().slice(0, 10)} = {r.erster.marktwert.toLocaleString("de-DE")} €
              {" bis "}
              {r.letzter.tag.toISOString().slice(0, 10)} = {r.letzter.marktwert.toLocaleString("de-DE")} €
            </p>
          )}
          {r.ok && <pre className="kb-roh">{r.roh}</pre>}
        </section>
      ))}
    </main>
  );
}
