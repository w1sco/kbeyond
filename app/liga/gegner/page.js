import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { initSchema, getSpielePunkte, getKader, sql } from "@/lib/db";
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
// **nächsten fünf Gegner** stehen, und listet darunter seine Spieler.
export default async function Gegner({ searchParams }) {
  const { token } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);
  await initSchema();

  const [spiele, pool, kader, ranking, fortschritt] = await Promise.all([
    getSpielePunkte(),
    holePool(),
    getKader(leagueId),
    kbFetch(`/v4/leagues/${leagueId}/ranking`, token),
    sql`SELECT COUNT(*)::int AS n FROM leistung_geprueft`,
  ]);

  const gespielt = gewertete(spiele);
  const fMap = faktoren(spiele);
  const heim = heimfaktor(spiele);
  const schnitt = ligaSchnitt(spiele);

  // Vereine aus dem Spielerpool – dort steht die Zuordnung Spieler → Verein.
  const vereine = new Map();
  for (const s of pool.spieler ?? []) {
    const id = String(s.teamId ?? "");
    if (!id) continue;
    if (!vereine.has(id)) vereine.set(id, { id, name: s.verein ?? `Verein ${id}`, spieler: [] });
    vereine.get(id).spieler.push(s);
  }
  // Vereine, die im Spielplan stehen, aber (noch) nicht im Pool.
  for (const s of spiele) {
    for (const id of [s.heim, s.gast]) {
      if (!vereine.has(id)) vereine.set(id, { id, name: `Verein ${id}`, spieler: [] });
    }
  }

  const besetzt = kader.besetzt ?? new Set();
  const nameVon = (id) => vereine.get(String(id))?.name ?? `Verein ${id}`;

  const zeilen = [...vereine.values()]
    .map((v) => {
      const kommende = naechsteSpiele(spiele, v.id);
      const bewertung = gegnerScore(kommende, fMap, heim);
      // Die eigene Bilanz: was gegen diesen Verein geholt wurde, je Spiel.
      const bilanz = gespielt
        .filter((s) => s.heim === v.id || s.gast === v.id)
        .map((s) => {
          const daheim = s.heim === v.id;
          return {
            spieltag: s.spieltag,
            gegner: daheim ? s.gast : s.heim,
            daheim,
            eigene: daheim ? s.punkteHeim : s.punkteGast,
            zugestanden: daheim ? s.punkteGast : s.punkteHeim,
          };
        });
      return {
        ...v,
        kommende,
        score: bewertung?.score ?? null,
        teile: bewertung?.teile ?? [],
        eigen: fMap.get(v.id) ?? null,
        bilanz,
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));

  const ohneSpielplan = spiele.length === 0;
  const ohnePunkte = !ohneSpielplan && gespielt.length === 0;
  const geprueft = fortschritt[0]?.n ?? 0;
  const spielerGesamt = (pool.spieler ?? []).length;

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

      {ohneSpielplan ? (
        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">Noch kein Spielplan geladen</h2>
          <p>
            Der Spielplan kommt beim <strong>Aktualisieren</strong> mit — er kostet einen
            einzigen Kickbase-Aufruf für alle 34 Spieltage. Danach stehen hier die
            nächsten fünf Gegner jedes Vereins.
          </p>
          <p>
            <Link href={`/liga?league=${leagueId}`} className="kb-btn kb-btn--haupt">
              Zur Liga und aktualisieren
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
              <strong>{gespielt.length === 0 ? "–" : `${Math.round((heim.heim - 1) * 100)} %`}</strong>
            </div>
            <div>
              <span className="kb-label">Grundlage</span>
              <strong>{gespielt.length} Partien</strong>
            </div>
          </div>

          {ohnePunkte && (
            <p className="kb-warnung">
              Der Spielplan steht, die <strong>Punkte je Spiel</strong> fehlen noch:
              {" "}{geprueft} von {spielerGesamt || "?"} Spielern sind abgeholt. Das kostet
              einen Aufruf je Spieler und läuft deshalb in Häppchen — ein paarmal
              aktualisieren, dann steht der Score. Die Ansetzungen unten stimmen bereits.
            </p>
          )}

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
              Die nächsten fünf Spiele wiegen <strong>{GEWICHTE.join(" : ")}</strong> — das
              nächste trägt damit ein Drittel. <strong>100</strong> ist Ligaschnitt,
              {" "}<strong>118</strong> heißt: die kommenden Gegner sind zusammen rund 18 %
              durchlässiger als üblich.
            </p>
            <p>
              <strong>Wenige Spiele werden gedämpft.</strong> Am zweiten Spieltag hat jede
              Mannschaft ein einziges Spiel — ein Ausreißer bestimmte sonst die ganze
              Bewertung. Der Schnitt wird zum Ligaschnitt hingezogen, als hätte jede
              Mannschaft drei zusätzliche, genau durchschnittliche Spiele bestritten.
            </p>
            <p>
              Die Punkte einer Mannschaft sind die Summe ihrer Spieler in diesem einen
              Spiel, aus Kickbases eigener Leistungsreihe. Maßgeblich ist dabei der Verein
              <strong> zum Zeitpunkt des Spiels</strong> — ein Winterwechsel zählt für
              beide Vereine richtig.
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
                        {v.bilanz.length > 0 && (
                          <ul className="kb-elfliste">
                            {v.bilanz.map((b) => (
                              <li key={b.spieltag}>
                                <span className="kb-leise">
                                  {b.spieltag}. {b.daheim ? "vs" : "bei"}
                                </span>
                                <span className="kb-livename">{nameVon(b.gegner)}</span>
                                <strong>{b.eigene ?? "–"}</strong>
                                <span className="kb-leise">({b.zugestanden ?? "–"})</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <ul className="kb-elfliste">
                          {v.spieler
                            .slice()
                            .sort((a, b) => (b.marktwert ?? 0) - (a.marktwert ?? 0))
                            .slice(0, 10)
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
                      {v.kommende.length === 0
                        ? "Saison durch"
                        : v.kommende
                            .map((t) => `${t.heim ? "" : "@"}${nameVon(t.gegner)}`)
                            .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="kb-info">
            Aufgeklappt stehen oben die bisherigen Spiele des Vereins (eigene Punkte, in
            Klammern die des Gegners), darunter seine teuersten Spieler. „gesteht zu“ ist
            der rohe Schnitt der Punkte, die Gegner gegen ihn geholt haben — ungedämpft,
            damit die Datenlage ablesbar bleibt.
          </p>
        </>
      )}
    </main>
  );
}
