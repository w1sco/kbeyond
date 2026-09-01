import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { initSchema, getSpiele, getKader } from "@/lib/db";
import { holePool } from "@/lib/rekonstruktion";
import { euroKurz } from "@/lib/format";
import {
  GEWICHTE, faktoren, heimfaktor, ligaSchnitt, gegnerScore, naechsteSpiele, gewertete,
} from "@/lib/gegner";
import Hinweis from "@/app/_ui/Hinweis";

export const dynamic = "force-dynamic";

// Auf wen soll man setzen? Die Antwort hängt am Gegner: Gegen eine
// durchlässige Mannschaft holen Spieler mehr Punkte als gegen eine zähe.
//
// Diese Seite bewertet deshalb jeden Verein danach, wie günstig seine
// **nächsten fünf Gegner** stehen — das nächste Spiel am stärksten
// gewichtet — und listet darunter seine Spieler.
export default async function Gegner({ searchParams }) {
  const { token } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);
  await initSchema();

  const [spiele, pool, kader, ranking] = await Promise.all([
    getSpiele(),
    holePool(),
    getKader(leagueId),
    kbFetch(`/v4/leagues/${leagueId}/ranking`, token),
  ]);

  const gespielt = gewertete(spiele);
  const fMap = faktoren(spiele);
  const heim = heimfaktor(spiele);
  const schnitt = ligaSchnitt(spiele);

  // Vereine aus dem Spielerpool – dort steht die Zuordnung Spieler → Verein.
  const vereine = new Map();
  // holePool() liefert { spieler, stand, leer } – keine blanke Liste.
  for (const s of pool.spieler ?? []) {
    const id = String(s.teamId ?? "");
    if (!id) continue;
    if (!vereine.has(id)) vereine.set(id, { id, name: s.verein ?? `Verein ${id}`, spieler: [] });
    vereine.get(id).spieler.push(s);
  }

  // Wem gehört wer? Für den Hinweis „gehört bereits jemandem".
  const besetzt = kader.besetzt ?? new Set();

  const zeilen = [...vereine.values()]
    .map((v) => {
      const kommende = naechsteSpiele(spiele, v.id);
      const bewertung = gegnerScore(kommende, fMap, heim);
      return {
        ...v,
        kommende,
        score: bewertung?.score ?? null,
        teile: bewertung?.teile ?? [],
        eigen: fMap.get(v.id) ?? null,
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const nameVon = (id) => vereine.get(String(id))?.name ?? `Verein ${id}`;
  const ohneDaten = gespielt.length === 0;

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Gegner der nächsten Spiele</h1>
          <p className="kb-unter">
            {ranking?.ti ?? "Liga"} · {vereine.size} Vereine · {gespielt.length} gewertete Partien
          </p>
        </div>
      </header>

      {ohneDaten ? (
        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">Noch kein Spielplan gespeichert</h2>
          <p>
            Für diese Auswertung fehlen zwei Dinge, die in diesem Projekt noch nicht belegt
            sind: der <strong>Spielplan</strong> (wer spielt wann gegen wen) und die
            <strong> Punkte einer Mannschaft je Spieltag</strong>. Der Kader trägt nur die
            Saisonsumme, und die Live-Punkte hängen am Manager, nicht am Verein.
          </p>
          <p className="kb-leise">
            Welcher Endpunkt beides liefert, klärt die Diagnoseseite — sie probiert rund
            sechzehn Kandidaten durch und zeigt für jeden den Aufbau der Antwort.
          </p>
          <p>
            <Link href={`/spielplan?league=${leagueId}`} className="kb-btn">
              Endpunkte suchen
            </Link>
          </p>
        </section>
      ) : (
        <>
          <div className="kb-kennzahlen">
            <div>
              <span className="kb-label">Ligaschnitt je Spiel</span>
              <strong>{schnitt == null ? "–" : Math.round(schnitt)} Punkte</strong>
            </div>
            <div>
              <span className="kb-label">Heimvorteil</span>
              <strong>{Math.round((heim.heim - 1) * 100)} %</strong>
            </div>
            <div>
              <span className="kb-label">Grundlage</span>
              <strong>{gespielt.length} Partien</strong>
            </div>
          </div>

          <Hinweis
            titel="Wie der Score entsteht"
            kurz="100 = Ligaschnitt. Das nächste Spiel trägt ein Drittel."
          >
            <p>
              Für jeden Verein wird gemessen, wie viele Punkte seine Gegner
              <strong> gegen ihn</strong> holen — nicht, wie viele er selbst macht. Wer auf
              Spieler setzen will, sucht den durchlässigen Gegner, nicht den schwachen
              Angriff.
            </p>
            <p>
              Die nächsten fünf Spiele werden mit <strong>{GEWICHTE.join(" : ")}</strong>
              {" "}gewichtet — das nächste trägt damit ein Drittel. <strong>100</strong> ist
              Ligaschnitt, <strong>118</strong> heißt: die kommenden Gegner sind zusammen
              rund 18 % durchlässiger als üblich.
            </p>
            <p>
              <strong>Wenige Spiele werden gedämpft.</strong> Am zweiten Spieltag hat jede
              Mannschaft ein einziges Spiel — ein Ausreißer bestimmte sonst die ganze
              Bewertung. Der Schnitt wird deshalb zum Ligaschnitt hingezogen, als hätte jede
              Mannschaft drei zusätzliche, genau durchschnittliche Spiele bestritten.
            </p>
            <p>
              Ein Gegner ohne Daten wird <strong>nicht geraten</strong> — er fällt aus der
              Rechnung, die übrigen Gewichte tragen ihn mit.
            </p>
          </Hinweis>

          <div className="kb-tabellenrahmen">
            <table className="kb-tabelle">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="kb-namensspalte">Verein</th>
                  <th>Score</th>
                  <th className="kb-sek">gesteht zu</th>
                  <th className="kb-sek">Nächste fünf</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((v, i) => (
                  <tr key={v.id}>
                    <td>{i + 1}</td>
                    <td className="kb-namensspalte">
                      <details className="kb-elfauf">
                        <summary>{v.name}</summary>
                        <ul className="kb-elfliste">
                          {v.spieler
                            .slice()
                            .sort((a, b) => (b.marktwert ?? 0) - (a.marktwert ?? 0))
                            .slice(0, 12)
                            .map((s) => (
                              <li key={s.id}>
                                <span className="kb-leise">{s.position ?? "?"}</span>
                                <span className="kb-livename">{s.name}</span>
                                {besetzt.has(String(s.id)) && (
                                  <span className="kb-leise" title="gehört bereits jemandem">·</span>
                                )}
                                <strong>{s.marktwert ? euroKurz(s.marktwert) : "–"}</strong>
                              </li>
                            ))}
                        </ul>
                      </details>
                    </td>
                    <td>
                      <strong className={v.score == null ? undefined
                        : v.score >= 105 ? "kb-plus" : v.score <= 95 ? "kb-minus" : undefined}>
                        {v.score ?? "–"}
                      </strong>
                    </td>
                    <td className="kb-sek kb-leise">
                      {v.eigen?.schnitt == null ? "–" : Math.round(v.eigen.schnitt)}
                    </td>
                    <td className="kb-sek kb-leise">
                      {v.teile.length === 0
                        ? "kein Spielplan"
                        : v.teile
                            .map((t) => `${t.heim ? "" : "@"}${nameVon(t.gegner)}`)
                            .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="kb-info">
            „gesteht zu“ ist der rohe Schnitt der Punkte, die Gegner gegen diesen Verein
            geholt haben — ungedämpft, damit die Datenlage ablesbar bleibt. In den Score
            geht der gedämpfte Wert ein.
          </p>
        </>
      )}
    </main>
  );
}
