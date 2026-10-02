import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { DiagnoseKopf, LigaFehlt, probiere, Rohdaten } from "../_diagnose/Endpunkte";
import { schluesselBaum } from "@/lib/aufstellung";
import { sql, initSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

// Wer spielt an welchem Spieltag gegen wen?
//
// Belegt ist `/v4/competitions/1/matchdays` — alle 34 Spieltage in einem
// Aufruf. Daran hängt inzwischen nur noch eine Sache, aber eine wichtige:
// **für welchen Spieltag die Startelf-Prognose gilt.** Ändert Kickbase
// die Form, sagt der Aktualisieren-Lauf zwar, dass es klemmt — woran, sagt
// erst diese Seite.
//
// Die zweite Suche (`?partie=1`) gilt der Matchup-Seite: Gibt es einen
// Endpunkt, der die Punkte **aller Spieler einer Partie** auf einmal
// liefert? Heute kostet ein Spieltag einen Aufruf je Spieler, rund 470 —
// mit so einem Endpunkt wären es neun.
export default async function Spielplan({ searchParams }) {
  const { token } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) return <LigaFehlt titel="Spielplan" />;

  await verlangeLiga(leagueId, token);

  if (p.partie === "1") return <PartieSuche leagueId={leagueId} token={token} />;

  // Auch das kostet ein Dutzend Aufrufe, also erst auf Klick — dieselbe
  // Regel wie bei /startelf.
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
            <Link prefetch={false} href={`/spielplan?league=${leagueId}&suchen=1`} className="kb-btn">
              Suche starten
            </Link>
          </p>
        </section>
        <section className="kb-karte">
          <p>
            Gesucht werden die <strong>Punkte aller Spieler einer Partie</strong> in einem
            Aufruf. Die Matchup-Seite fragt heute jeden Spieler einzeln — nach einem
            Spieltag rund 470 Aufrufe. Liefert einer dieser Pfade die Punkte je Spieler,
            wären es neun.
          </p>
          <p className="kb-leise">
            Rund <strong>fünf Kickbase-Aufrufe</strong> für die jüngste gewertete Partie.
          </p>
          <p>
            <Link prefetch={false} href={`/spielplan?league=${leagueId}&partie=1`} className="kb-btn">
              Partie-Suche starten
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

// Die Suche nach den Punkten einer ganzen Partie. Genommen wird die jüngste
// gewertete Partie aus dem Spielplan — bei einer kommenden stünden ohnehin
// keine Punkte drin.
async function PartieSuche({ leagueId, token }) {
  await initSchema();
  const r = await sql`
    SELECT mi, spieltag, heim, gast FROM spiele
    WHERE tore_heim IS NOT NULL AND tore_gast IS NOT NULL AND mi IS NOT NULL
    ORDER BY datum DESC NULLS LAST LIMIT 1`;
  const partie = r[0];

  if (!partie) {
    return (
      <main className="kb-seite kb-seite--schmal">
        <DiagnoseKopf titel="Punkte einer Partie" leagueId={leagueId} />
        <p className="kb-info">Noch keine gewertete Partie im Spielplan — einmal aktualisieren.</p>
      </main>
    );
  }

  const mi = partie.mi;
  const ergebnis = await probiere([
    `/v4/matches/${mi}/details`,
    `/v4/competitions/1/matches/${mi}/details`,
    `/v4/competitions/1/matches/${mi}`,
    `/v4/matches/${mi}`,
    `/v4/competitions/1/matches/${mi}/performance`,
  ], token);

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Punkte einer Partie"
        unter={`Partie ${mi} · Spieltag ${partie.spieltag} · ${ergebnis.filter((x) => x.ok).length} von ${ergebnis.length} antworten`}
        leagueId={leagueId}
      />
      <section className="kb-karte">
        <p className="kb-info">
          Gesucht ist eine Liste von Spielern beider Mannschaften, je mit ID und Punkten
          (wie `p` in der Leistungsreihe). Steht so etwas in einer Antwort, kann die
          Matchup-Seite auf einen Aufruf je Partie umstellen.
        </p>
        {ergebnis.map((x) => (
          <div key={x.pfad}>
            <h3 className="kb-pfad">
              <span className={x.ok ? "kb-marke--exakt" : "kb-minus"}>{x.ok ? "OK" : x.fehler}</span>{" "}
              {x.pfad}
            </h3>
            {x.ok && (
              <>
                <pre className="kb-roh">
                  {schluesselBaum(x.daten).slice(0, 60)
                    .map((z) => `${z.pfad} = ${z.wert}`).join("\n")}
                </pre>
                <Rohdaten daten={x.daten} />
              </>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
