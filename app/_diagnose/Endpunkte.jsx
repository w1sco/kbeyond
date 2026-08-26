// Gemeinsamer Baustein der Diagnose-Seiten.
//
// feed, ranking, spieler, pool, team und manager machen alle dasselbe: eine
// Liste von Endpoint-Kandidaten durchprobieren und die Antworten roh zeigen.
// Das stand sechsmal fast wortgleich im Code — jede Änderung am Aussehen
// hätte man sechsmal machen müssen.

import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";

// Probiert alle Pfade der Reihe nach. Fehler sind hier ein normales
// Ergebnis, kein Ausnahmefall — genau darum geht es bei der Diagnose.
export async function probiere(pfade, token) {
  const ergebnisse = [];
  for (const pfad of pfade) {
    try {
      ergebnisse.push({ pfad, ok: true, daten: await kbFetch(pfad, token) });
    } catch (e) {
      ergebnisse.push({ pfad, ok: false, fehler: e.message });
    }
  }
  return ergebnisse;
}

export function DiagnoseKopf({ titel, unter, leagueId }) {
  return (
    <header className="kb-kopf">
      <div>
        <Link href={leagueId ? `/liga?league=${leagueId}` : "/liga"} className="kb-zurueck">
          ← zurück zur Liga
        </Link>
        <h1 className="kb-titel" style={{ marginTop: 8 }}>{titel}</h1>
        {unter && <p className="kb-unter">{unter}</p>}
      </div>
    </header>
  );
}

// Ohne ?league= wurde früher eine fest verdrahtete Liga-ID abgefragt – je
// nach Seite eine andere, teils veraltete. Lieber ehrlich nachfragen.
export function LigaFehlt({ titel }) {
  return (
    <main className="kb-seite kb-seite--schmal">
      <DiagnoseKopf titel={titel} />
      <div className="kb-hinweis kb-hinweis--warn">
        Diese Seite braucht eine Liga. Ruf sie mit <code>?league=…</code> auf oder wähle
        die Liga über die <Link href="/liga">Ligaübersicht</Link>.
      </div>
    </main>
  );
}

export function Ergebnisse({ ergebnisse }) {
  const ok = ergebnisse.filter((r) => r.ok).length;

  return (
    <>
      <div className="kb-hinweis">
        {ok} von {ergebnisse.length} Endpoints erreichbar
      </div>

      {ergebnisse.map((r) => (
        <section key={r.pfad} className="kb-karte">
          <h2 className="kb-pfad">
            <span className={r.ok ? "kb-marke--exakt" : "kb-minus"}>{r.ok ? "OK" : r.fehler}</span>
            {" "}{r.pfad}
            {r.hinweis && <span className="kb-leise"> · {r.hinweis}</span>}
          </h2>
          {r.ok && <Rohdaten daten={r.daten} />}
        </section>
      ))}
    </>
  );
}

export function Rohdaten({ daten }) {
  return <pre className="kb-roh">{JSON.stringify(daten, null, 2)}</pre>;
}
