import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getKader } from "@/lib/db";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { ladeGrundlage, ladeLeistungen, standLeistungen } from "@/lib/matchupabruf";
import {
  werteMatchupsAus, vollstaendigeSeiten, bereichFuer, naechsterGegner, programm,
  POSITIONEN, ZEITRAEUME, MIN_SPIELE, VORSCHAU,
} from "@/lib/matchup";
import { zeitpunkt } from "@/lib/format";
import Hinweis from "../../_ui/Hinweis";
import Matchupholen from "./Matchupholen";

export const dynamic = "force-dynamic";

const POS_NAMEN = { alle: "alle Positionen", TW: "Torhüter", ABW: "Abwehr", MF: "Mittelfeld", ANG: "Sturm" };

// Matchups: Wie viele Punkte lässt jeder Verein zu — je Position?
//
// Zwei Ansichten auf dieselben Zahlen:
//
//   „Wer lässt zu“ — nach dem Vorbild des Matchup-Tools von KickbaseNerd:
//   oben die Vereine, die am meisten zulassen. Wer als Nächstes gegen sie
//   spielt, hat das leichte Matchup.
//
//   „Leichtes Programm“ — dieselbe Frage von der anderen Seite: Welcher
//   Verein hat über die nächsten 1, 3 oder 5 Spieltage die Gegner, gegen
//   die am meisten Punkte herauskommen? Dessen Spieler sind die Kandidaten.
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
  const ansicht = p.ansicht === "programm" ? "programm" : "zulassen";
  const vor = VORSCHAU.includes(Number(p.vor)) ? Number(p.vor) : 3;

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
  const meineBei = new Map();   // eigener Verein → meine Spieler
  for (const s of meineId ? kader.proManager.get(meineId) ?? [] : []) {
    if (pos !== "alle" && s.position !== pos) continue;
    const team = teamVon.get(String(s.id));
    if (!team) continue;
    const spieler = s.name ?? `Spieler #${s.id}`;
    if (!meineBei.has(team)) meineBei.set(team, []);
    meineBei.get(team).push(spieler);
    const n = naechsterGegner(g.spiele, team);
    if (!n) continue;
    if (!meineGegen.has(n.gegner)) meineGegen.set(n.gegner, []);
    meineGegen.get(n.gegner).push(spieler);
  }

  // Das Programm: je Verein die nächsten `vor` Gegner und was sie zulassen.
  const programmZeilen = programm({ spiele: g.spiele, zeilen, position: pos, anzahl: vor });

  const name = (team) => g.vereine.get(team) ?? `Verein #${team}`;
  const zahl = (n) => (n == null ? "–" : n.toLocaleString("de-DE", { maximumFractionDigits: 1 }));
  const mitDaten = zeilen.filter((z) => z.spiele > 0).length;
  // Partien im Zeitraum, von denen mindestens eine Seite noch fehlt.
  const offenePartien = g.spiele.filter((s) =>
    s.gewertet && bereich && s.spieltag >= bereich.von && s.spieltag <= bereich.bis &&
    (!vollstaendig.has(`${s.mi}|${s.heim}`) || !vollstaendig.has(`${s.mi}|${s.gast}`))).length;
  const adresse = (neu) => {
    const q = new URLSearchParams({
      league: leagueId, ansicht, pos, zeit: zeit.schluessel, vor: String(vor), ...neu });
    return `/liga/matchup?${q}`;
  };

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Matchups</h1>
          <p className="kb-unter">
            {ansicht === "programm"
              ? `Wer hat über die nächsten ${vor === 1 ? "Partie" : `${vor} Partien`} die Gegner, gegen die am meisten herauskommt — ${POS_NAMEN[pos]}`
              : `Punkte, die jeder Verein je Spiel zulässt — ${POS_NAMEN[pos]}`}
            {bereich ? `, gemessen an Spieltag ${bereich.von}–${bereich.bis}` : ""}
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
          <strong>„Leichtes Programm“</strong> dreht die Frage um: Für jeden Verein werden
          seine nächsten 1, 3 oder 5 Gegner genommen, und für jeden, wie viele Punkte er auf
          der gewählten Position je Spiel zulässt. Der Schnitt darüber steht oben, wenn das
          Programm leicht ist. Die Spieler dieses Vereins sind die Kandidaten.
        </p>
        <p>
          <strong>Ein Schnitt nur, wenn jeder dieser Gegner bekannt ist.</strong> Fehlt einer,
          steht „2 von 3 bekannt“ und kein Rang — ein Schnitt aus den bekannten sähe aus wie
          ein echter, wäre aber nur der Wert eines einzelnen Gegners. Heimvorteil wird nicht
          eingerechnet; ob zu Hause oder auswärts, steht beim Gegner dabei.
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

      {/* Zwei Ansichten, ein Werkzeug: Position und Zeitraum gelten für beide. */}
      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Ansicht">
        {[["zulassen", "Wer lässt zu"], ["programm", "Leichtes Programm"]].map(([k, label]) => (
          <Link key={k} href={adresse({ ansicht: k })}
                className={`kb-sortchip${ansicht === k ? " kb-sortchip--aktiv" : ""}`}
                aria-current={ansicht === k ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </div>

      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Position" style={{ marginTop: 8 }}>
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
      {ansicht === "programm" && (
        <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Vorschau" style={{ marginTop: 8 }}>
          {VORSCHAU.map((n) => (
            <Link key={n} href={adresse({ vor: String(n) })}
                  className={`kb-sortchip${vor === n ? " kb-sortchip--aktiv" : ""}`}
                  aria-current={vor === n ? "true" : undefined}>
              {n === 1 ? "nächstes Spiel" : `nächste ${n}`}
            </Link>
          ))}
        </div>
      )}

      {!bereich ? (
        <p className="kb-info">Noch keine gewertete Partie im Spielplan.</p>
      ) : mitDaten === 0 ? (
        <p className="kb-info">
          Für diesen Zeitraum ist noch keine Partie vollständig geladen — oben die Punkte je
          Spiel holen.
        </p>
      ) : ansicht === "programm" ? (
        <div className="kb-tabellenrahmen" style={{ marginTop: 12 }}>
          <table className="kb-tabelle kb-tabelle--schmal">
            <thead>
              <tr>
                <th scope="col" className="kb-rang">#</th>
                <th scope="col" className="kb-namensspalte">Verein</th>
                <th scope="col" className="kb-aktiv" title="Schnitt der zugelassenen Punkte je Spiel über die nächsten Gegner">Ø Gegner</th>
                <th scope="col">Die nächsten Gegner</th>
              </tr>
            </thead>
            <tbody>
              {programmZeilen.map((r, i) => {
                const meine = meineBei.get(r.team) ?? [];
                return (
                  <tr key={r.team} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                    <td className="kb-rang">{r.rang ?? "–"}</td>
                    <td className="kb-namensspalte">
                      <span className="kb-spielername">{name(r.team)}</span>
                      {r.wenig && <span className="kb-leise"> wenig Daten</span>}
                      {meine.length > 0 && (
                        <span className="kb-matchupmeine" title="Deine Spieler in diesem Verein">
                          deine: {meine.join(", ")}
                        </span>
                      )}
                    </td>
                    <td>
                      {r.schnitt != null ? <strong>{zahl(r.schnitt)}</strong>
                        : r.gegner.length === 0 ? <span className="kb-gedaempft">–</span>
                        : <span className="kb-leise">{r.bekannt} von {r.gegner.length} bekannt</span>}
                      {r.schnitt != null && r.gegner.length < vor && (
                        <span className="kb-leise"> nur {r.gegner.length}</span>
                      )}
                    </td>
                    <td>
                      <span className="kb-programm">
                        {r.gegner.map((x) => (
                          <span key={`${x.spieltag}-${x.gegner}`}
                                title={`Spieltag ${x.spieltag}${x.datum ? ` · ${zeitpunkt(x.datum)}` : ""} · ${x.heim ? "zu Hause" : "auswärts"}`}>
                            <span className="kb-leise">{x.heim ? "H" : "A"}</span> {name(x.gegner)}{" "}
                            <span className={x.schnitt == null ? "kb-gedaempft" : ""}>{zahl(x.schnitt)}</span>
                          </span>
                        ))}
                        {r.gegner.length === 0 && <span className="kb-gedaempft">keine Partie mehr</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
