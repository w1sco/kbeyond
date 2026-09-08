import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { DiagnoseKopf, LigaFehlt, probiere, Rohdaten } from "../_diagnose/Endpunkte";
import { schluesselBaum } from "@/lib/aufstellung";

export const dynamic = "force-dynamic";

// Wer spielt an welchem Spieltag gegen wen?
//
// Belegt ist `/v4/competitions/1/matchdays` — alle 34 Spieltage in einem
// Aufruf. Daran hängt inzwischen nur noch eine Sache, aber eine wichtige:
// **für welchen Spieltag die Startelf-Prognose gilt.** Ändert Kickbase
// die Form, sagt der Aktualisieren-Lauf zwar, dass es klemmt — woran, sagt
// erst diese Seite.
//
// Ihre zweite Hälfte suchte einmal die **Punkte je Spieltag** für die
// Gegner-Auswertung. Die Seite ist raus, die Suche danach auch.
export default async function Spielplan({ searchParams }) {
  const { token } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) return <LigaFehlt titel="Spielplan" />;

  await verlangeLiga(leagueId, token);

  // Auch das kostet ein Dutzend Aufrufe, also erst auf Klick — dieselbe
  // Regel wie bei /livepunkte und /startelf.
  if (p.suchen !== "1") {
    return (
      <main className="kb-seite kb-seite--schmal">
        <DiagnoseKopf titel="Spielplan" leagueId={leagueId} />
        <section className="kb-karte">
          <p>
            Gesucht wird der <strong>Spielplan</strong>: wer spielt an welchem
            Spieltag gegen wen, zu Hause oder auswärts, und wie ist es
            ausgegangen. Daran hängt, für welchen Spieltag die Startelf-Prognose
            gilt.
          </p>
          <p className="kb-leise">
            Rund <strong>zwölf Kickbase-Aufrufe</strong>. Läuft deshalb erst auf Klick.
          </p>
          <p>
            <Link href={`/spielplan?league=${leagueId}&suchen=1`} className="kb-btn">
              Suche starten
            </Link>
          </p>
        </section>
      </main>
    );
  }

  // Ein paar Kandidaten hängen an einer Vereins-ID.
  let tid = p.tid ?? null;
  try {
    const tabelle = await kbFetch("/v4/competitions/1/table", token);
    const ersteListe = Object.values(tabelle ?? {}).find(Array.isArray) ?? [];
    tid = tid ?? String(ersteListe[0]?.tid ?? ersteListe[0]?.i ?? "");
  } catch { /* dann eben ohne – die Pfade ohne ID gehen trotzdem */ }

  const plan = await probiere([
    "/v4/competitions/1/matches",
    "/v4/competitions/1/matchdays",
    "/v4/competitions/1/matchday",
    "/v4/competitions/1/schedule",
    "/v4/competitions/1/fixtures",
    "/v4/competitions/1/table",
    `/v4/leagues/${leagueId}/matches`,
    `/v4/leagues/${leagueId}/matchdays`,
    ...(tid ? [
      `/v4/competitions/1/teams/${tid}/matches`,
      `/v4/competitions/1/teams/${tid}/teamcenter`,
    ] : []),
  ], token);

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Spielplan"
        unter={`Verein ${tid ?? "?"} · ${plan.filter((r) => r.ok).length} von ${plan.length} antworten`}
        leagueId={leagueId}
      />

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">Wer spielt wann gegen wen</h2>
        <p className="kb-info">
          Gesucht ist eine Liste mit Spieltag, zwei Mannschaften und — sobald
          gespielt — dem Ergebnis. Gewertet ist, was Tore trägt; eine kommende
          Partie lässt sie einfach weg.
        </p>
        {plan.map((r) => (
          <div key={r.pfad}>
            <h3 className="kb-pfad">
              <span className={r.ok ? "kb-marke--exakt" : "kb-minus"}>{r.ok ? "OK" : r.fehler}</span>{" "}
              {r.pfad}
            </h3>
            {r.ok && (
              <>
                {/* Der Aufbau zuerst: Daran sieht man in einer Zeile, ob
                    überhaupt etwas Passendes drinsteht. */}
                <pre className="kb-roh">
                  {schluesselBaum(r.daten).slice(0, 40)
                    .map((z) => `${z.pfad} = ${z.wert}`).join("\n")}
                </pre>
                <Rohdaten daten={r.daten} />
              </>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
