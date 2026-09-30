import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getKader } from "@/lib/db";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { ladeGrundlage, ladeLeistungen, standLeistungen } from "@/lib/matchupabruf";
import {
  werteMatchupsAus, vollstaendigeSeiten, bereichFuer, naechsterGegner,
  POSITIONEN, ZEITRAEUME, MIN_SPIELE,
} from "@/lib/matchup";
import { zeitpunkt } from "@/lib/format";
import Hinweis from "../../_ui/Hinweis";
import Matchupholen from "./Matchupholen";

export const dynamic = "force-dynamic";

const POS_NAMEN = { alle: "alle Positionen", TW: "Torhüter", ABW: "Abwehr", MF: "Mittelfeld", ANG: "Sturm" };

// Matchups: Wie viele Punkte lässt jeder Verein zu — je Position?
//
// Nach dem Vorbild des Matchup-Tools von KickbaseNerd: Oben stehen die
// Vereine, die am meisten zulassen. Wer als Nächstes gegen sie spielt, hat
// das leichte Matchup.
//
// Die Seite selbst kostet keinen Kickbase-Aufruf außer der Mitgliedsprüfung
// (und der Rangliste, falls die eigene Zuordnung nur über den Namen geht).
// Die Punkte je Spiel kommen über den eigenen Knopf herein.
export default async function Matchup({ searchParams }) {
  const { token, uid: meineUid, name: meinName } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) {
    return (
      <main className="kb-seite">
        <p className="kb-info">Liga fehlt. <Link href="/liga">Zur Ligaauswahl</Link></p>
      </main>
    );
  }
  await verlangeLiga(leagueId, token);
  await initSchema();

  const pos = ["alle", ...POSITIONEN].includes(p.pos) ? p.pos : "alle";
  const zeit = ZEITRAEUME.find((z) => z.schluessel === p.zeit) ?? ZEITRAEUME[1];

  const g = await ladeGrundlage();
  const [leistungen, stand, kader] = await Promise.all([
    ladeLeistungen(g.position),
    standLeistungen(),
    getKader(leagueId),
  ]);

  const bereich = bereichFuer(g.spiele, zeit.spieltage);
  const vollstaendig = vollstaendigeSeiten(g);
  const { zeilen, ohnePosition } = werteMatchupsAus({
    spiele: g.spiele, leistungen, vollstaendig, bereich,
  });

  // Sortiert nach der gewählten Position: wer am meisten zulässt, oben.
  // Ohne gezähltes Spiel ans Ende.
  zeilen.sort((a, b) => {
    const av = a.jePosition[pos].schnitt;
    const bv = b.jePosition[pos].schnitt;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  // Meine Spieler: Gegen welchen Verein spielt jeder als Nächstes? Dann
  // steht er in dessen Zeile — dort, wo man nachsieht, ob das Matchup gut ist.
  let meineId = meineUid && kader.proManager.has(String(meineUid)) ? String(meineUid) : null;
  if (!meineId && meinName) {
    try {
      const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
      const ich = (ranking?.us ?? []).find((m) => m.n === meinName);
      if (ich) meineId = String(ich.i);
    } catch { /* ohne Zuordnung eben ohne „deine Spieler“ */ }
  }
  const teamVon = new Map();
  for (const [team, ids] of g.kader) for (const id of ids) teamVon.set(id, team);
  const meineGegen = new Map(); // gegnerischer Verein → meine Spieler
  for (const s of meineId ? kader.proManager.get(meineId) ?? [] : []) {
    if (pos !== "alle" && s.position !== pos) continue;
    const team = teamVon.get(String(s.id));
    const n = team ? naechsterGegner(g.spiele, team) : null;
    if (!n) continue;
    if (!meineGegen.has(n.gegner)) meineGegen.set(n.gegner, []);
    meineGegen.get(n.gegner).push(s.name ?? `Spieler #${s.id}`);
  }

  const name = (team) => g.vereine.get(team) ?? `Verein #${team}`;
  const zahl = (n) => (n == null ? "–" : n.toLocaleString("de-DE", { maximumFractionDigits: 1 }));
  const mitDaten = zeilen.filter((z) => z.spiele > 0).length;
  // Partien im Zeitraum, von denen mindestens eine Seite noch fehlt.
  const offenePartien = g.spiele.filter((s) =>
    s.gewertet && bereich && s.spieltag >= bereich.von && s.spieltag <= bereich.bis &&
    (!vollstaendig.has(`${s.mi}|${s.heim}`) || !vollstaendig.has(`${s.mi}|${s.gast}`))).length;
  const adresse = (neu) => {
    const q = new URLSearchParams({ league: leagueId, pos, zeit: zeit.schluessel, ...neu });
    return `/liga/matchup?${q}`;
  };

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Matchups</h1>
          <p className="kb-unter">
            Punkte, die jeder Verein je Spiel zulässt — {POS_NAMEN[pos]}
            {bereich ? `, Spieltag ${bereich.von}–${bereich.bis}` : ""}
          </p>
        </div>
      </header>

      <Hinweis kurz="Wie man die Tabelle liest" titel="Matchups">
        <p>
          Gezählt wird, was die <strong>Gegner</strong> eines Vereins in dessen Spielen an
          Kickbase-Punkten geholt haben, getrennt nach Position, geteilt durch die Zahl der
          Spiele. <strong>Oben steht, wer am meisten zulässt.</strong> Wer als Nächstes gegen
          diesen Verein spielt, hat das leichte Matchup — die Spalte rechts sagt, wer das ist.
        </p>
        <p>
          Am meisten sagt die Tabelle zusammen mit der Startelf-Chance: ein Spieler, der
          sicher spielt und gegen einen Verein antritt, der auf seiner Position viel zulässt.
        </p>
        <p>
          <strong>Nur vollständige Partien zählen.</strong> Eine Partie kommt erst in die
          Rechnung, wenn alle Spieler des Gegners nach ihrem Ende abgefragt sind. Eine halb
          geladene Mannschaft sähe sonst aus wie ein starker Gegner. Solche Partien stehen
          als „offen“ daneben.
        </p>
        <p>
          <strong>Unter {MIN_SPIELE} Spielen ist ein Schnitt ein Zufall.</strong> Er wird
          gezeigt, aber mit „wenig Daten“ markiert. Die Position ist die heutige aus der
          Spielerliste; der Verein ist der zum Zeitpunkt des Spiels.
        </p>
        <p>
          Die Punkte kommen über einen Kickbase-Aufruf je Spieler. Gefragt wird nur, wer
          seit seiner letzten Abfrage gespielt hat — nach einem vollen Spieltag sind das
          aber alle, rund fünf Minuten. Deshalb läuft das nie von selbst mit, sondern nur
          über den Knopf.
        </p>
      </Hinweis>

      <Matchupholen leagueId={leagueId} stand={stand} />

      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Position">
        {["alle", ...POSITIONEN].map((k) => (
          <Link key={k} href={adresse({ pos: k })}
                className={`kb-sortchip${pos === k ? " kb-sortchip--aktiv" : ""}`}
                aria-current={pos === k ? "true" : undefined}>
            {k === "alle" ? "Gesamt" : k}
          </Link>
        ))}
      </div>
      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Zeitraum" style={{ marginTop: 8 }}>
        {ZEITRAEUME.map((z) => (
          <Link key={z.schluessel} href={adresse({ zeit: z.schluessel })}
                className={`kb-sortchip${zeit.schluessel === z.schluessel ? " kb-sortchip--aktiv" : ""}`}
                aria-current={zeit.schluessel === z.schluessel ? "true" : undefined}>
            {z.label}
          </Link>
        ))}
      </div>

      {!bereich ? (
        <p className="kb-info">Noch keine gewertete Partie im Spielplan.</p>
      ) : mitDaten === 0 ? (
        <p className="kb-info">
          Für diesen Zeitraum ist noch keine Partie vollständig geladen — oben die Punkte je
          Spiel holen.
        </p>
      ) : (
        <div className="kb-tabellenrahmen" style={{ marginTop: 12 }}>
          <table className="kb-tabelle kb-tabelle--schmal">
            <thead>
              <tr>
                <th scope="col" className="kb-rang">#</th>
                <th scope="col" className="kb-namensspalte">Verein</th>
                {["alle", ...POSITIONEN].map((k) => (
                  <th key={k} scope="col" className={k === pos ? "kb-aktiv" : "kb-sek"}>
                    {k === "alle" ? "Gesamt" : k}
                  </th>
                ))}
                <th scope="col" className="kb-sek">Spiele</th>
                <th scope="col">Als Nächstes gegen</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z, i) => {
                const meine = meineGegen.get(z.team) ?? [];
                return (
                  <tr key={z.team} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                    <td className="kb-rang">{z.jePosition[pos].rang ?? "–"}</td>
                    <td className="kb-namensspalte">
                      <span className="kb-spielername">{name(z.team)}</span>
                      {z.wenig && <span className="kb-leise"> wenig Daten</span>}
                      {meine.length > 0 && (
                        <span className="kb-matchupmeine" title="Deine Spieler, die als Nächstes gegen diesen Verein spielen">
                          deine: {meine.join(", ")}
                        </span>
                      )}
                    </td>
                    {["alle", ...POSITIONEN].map((k) => (
                      <td key={k} className={k === pos ? "" : "kb-sek"}>
                        {k === pos ? <strong>{zahl(z.jePosition[k].schnitt)}</strong> : zahl(z.jePosition[k].schnitt)}
                      </td>
                    ))}
                    <td className="kb-sek">
                      {z.spiele}
                      {z.offen > 0 && <span className="kb-leise"> +{z.offen} offen</span>}
                    </td>
                    <td>
                      {z.naechster ? (
                        <span title={z.naechster.datum ? `Spieltag ${z.naechster.spieltag} · ${zeitpunkt(z.naechster.datum)}` : undefined}>
                          {/* Aus Sicht dieser Zeile: Kommt der Gegner hierher,
                              oder fährt dieser Verein zu ihm? */}
                          {z.naechster.heim
                            ? <>{name(z.naechster.gegner)}<span className="kb-leise"> kommt</span></>
                            : <><span className="kb-leise">bei </span>{name(z.naechster.gegner)}</>}
                        </span>
                      ) : <span className="kb-gedaempft">–</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="kb-legende">
        {mitDaten} von {zeilen.length} Vereinen mit gezählten Spielen
        {offenePartien > 0 && ` · ${offenePartien} Partien noch nicht vollständig geladen`}
        {ohnePosition > 0 && ` · ${ohnePosition} Einsätze ohne bekannte Position (zählen nur in „Gesamt“)`}
      </p>
    </main>
  );
}
