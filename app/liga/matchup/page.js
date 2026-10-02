import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getKader } from "@/lib/db";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { ladeGrundlage, ladeLeistungen, standLeistungen } from "@/lib/matchupabruf";
import {
  werteMatchupsAus, vollstaendigeSeiten, bereichFuer, naechsterGegner, programm,
  POSITIONEN, ZEITRAEUME, MIN_SPIELE, VORSCHAU, MASSE,
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
        <p className="kb-info">Liga fehlt. <Link prefetch={false} href="/liga">Zur Ligaauswahl</Link></p>
      </main>
    );
  }
  await verlangeLiga(leagueId, token);
  await initSchema();

  const pos = ["alle", ...POSITIONEN].includes(p.pos) ? p.pos : "alle";
  const zeit = ZEITRAEUME.find((z) => z.schluessel === p.zeit) ?? ZEITRAEUME[1];
  const ansicht = p.ansicht === "programm" ? "programm" : "zulassen";
  const vor = VORSCHAU.includes(Number(p.vor)) ? Number(p.vor) : 3;
  // Leichte Gegner allein reichen nicht — die eigene Mannschaft muss auch
  // punkten. Vorgabe ist deshalb „mit eigener Stärke“.
  const mitEigener = p.wertung !== "gegner";
  // Je Spieler (Vorgabe) oder je Mannschaft. Je Spieler, weil ein Manager
  // einen Verteidiger besitzt und nicht die Kette — und weil eine Fünferkette
  // sonst mehr „zulässt“ als eine Dreierkette, nur weil mehr Leute darin stehen.
  const mass = MASSE.includes(p.je) ? p.je : "spieler";
  const einheit = mass === "spieler" ? "je Spieler" : "je Spiel";

  const g = await ladeGrundlage();
  const [leistungen, stand, kader] = await Promise.all([
    ladeLeistungen(g.position),
    standLeistungen(),
    getKader(leagueId),
  ]);

  const bereich = bereichFuer(g.spiele, zeit.spieltage);
  const vollstaendig = vollstaendigeSeiten(g);
  const { zeilen, ohnePosition, ligaschnitt } = werteMatchupsAus({
    spiele: g.spiele, leistungen, vollstaendig, bereich, mass,
  });

  // Sortiert nach der gewählten Position: wer am meisten zulässt, oben.
  // Ohne gezähltes Spiel ans Ende.
  zeilen.sort((a, b) => {
    const av = a.jePosition[pos].wert;
    const bv = b.jePosition[pos].wert;
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
  const programmZeilen = programm({
    spiele: g.spiele, zeilen, position: pos, anzahl: vor, mitEigener, ligaschnitt });
  const liga = ligaschnitt?.[pos] ?? null;

  const name = (team) => g.vereine.get(team) ?? `Verein #${team}`;
  const zahl = (n) => (n == null ? "–" : n.toLocaleString("de-DE", { maximumFractionDigits: 1 }));
  const mitDaten = zeilen.filter((z) => z.spiele > 0).length;
  // Partien im Zeitraum, von denen mindestens eine Seite noch fehlt.
  const offenePartien = g.spiele.filter((s) =>
    s.gewertet && bereich && s.spieltag >= bereich.von && s.spieltag <= bereich.bis &&
    (!vollstaendig.has(`${s.mi}|${s.heim}`) || !vollstaendig.has(`${s.mi}|${s.gast}`))).length;
  const adresse = (neu) => {
    const q = new URLSearchParams({
      league: leagueId, ansicht, pos, zeit: zeit.schluessel, vor: String(vor),
      wertung: mitEigener ? "beides" : "gegner", je: mass, ...neu });
    return `/liga/matchup?${q}`;
  };

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link prefetch={false} href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Matchups</h1>
          <p className="kb-unter">
            {ansicht === "programm"
              ? mitEigener
                ? `Was über die nächsten ${vor === 1 ? "Partie" : `${vor} Partien`} zu erwarten ist, eigene Stärke und Gegner zusammen — ${POS_NAMEN[pos]}`
                : `Wer hat über die nächsten ${vor === 1 ? "Partie" : `${vor} Partien`} die Gegner, gegen die am meisten herauskommt — ${POS_NAMEN[pos]}`
              : mass === "spieler"
                ? `Punkte, die ein Spieler gegen jeden Verein im Schnitt holt — ${POS_NAMEN[pos]}`
                : `Punkte, die jeder Verein je Spiel zulässt — ${POS_NAMEN[pos]}`}
            {bereich ? `, gemessen an Spieltag ${bereich.von}–${bereich.bis}` : ""}
            {ansicht === "programm" ? ` · ${einheit}` : ""}
          </p>
        </div>
      </header>

      <Hinweis kurz="Wie man die Tabelle liest" titel="Matchups">
        <p>
          Gezählt wird, was die <strong>Gegner</strong> eines Vereins in dessen Spielen an
          Kickbase-Punkten geholt haben, getrennt nach Position. <strong>Oben steht, wer am
          meisten zulässt.</strong> Wer als Nächstes gegen diesen Verein spielt, hat das
          leichte Matchup — die Spalte rechts sagt, wer das ist.
        </p>
        <p>
          <strong>Je Spieler (Vorgabe)</strong> teilt durch die Einsätze auf der Position,
          nicht durch die Spiele. Sonst sähe ein Verein abwehrschwach aus, nur weil seine
          Gegner mit Fünferkette angetreten sind: fünf Verteidiger in der Summe statt drei.
          Gerechnet wird über den ganzen Zeitraum zusammengefasst, alle Punkte durch alle
          Einsätze. <strong>Je Mannschaft</strong> zeigt die Summe je Spiel, also wie viel
          insgesamt herauskommt.
        </p>
        <p>
          Zwei Grenzen. Es zählt die Position, die Kickbase führt, nicht die Rolle auf dem
          Platz — ein Schienenspieler, den Kickbase als Mittelfeld führt, zählt dort. Und
          ein Einwechselspieler zählt als voller Einsatz, auch nach zehn Minuten; das drückt
          den Schnitt je Spieler bei allen Vereinen ähnlich.
        </p>
        <p>
          <strong>„Leichtes Programm“</strong> dreht die Frage um: Für jeden Verein werden
          seine nächsten 1, 3 oder 5 Gegner genommen, und für jeden, wie viele Punkte er auf
          der gewählten Position je Spiel zulässt. Der Schnitt darüber steht oben, wenn das
          Programm leicht ist. Die Spieler dieses Vereins sind die Kandidaten.
        </p>
        <p>
          <strong>Mit eigener Stärke</strong> (Vorgabe) zählt auch, wie viel die eigene
          Mannschaft auf der Position selbst punktet — leichte Gegner allein reichen nicht.
          Je Partie gilt: <em>eigene Punkte je Spiel + was der Gegner zulässt −
          Ligaschnitt</em>. Beides wird als Abstand zum Ligaschnitt gemessen und
          zusammengezählt: Wer 10 über dem Schnitt punktet und auf einen Gegner trifft, der 5
          über dem Schnitt zulässt, landet 15 darüber. Die Zahl bleibt in Punkten. Sie ist
          eine Einordnung aus dem, was bisher passiert ist, keine Vorhersage.
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
          <Link prefetch={false} key={k} href={adresse({ ansicht: k })}
                className={`kb-sortchip${ansicht === k ? " kb-sortchip--aktiv" : ""}`}
                aria-current={ansicht === k ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </div>

      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Position" style={{ marginTop: 8 }}>
        {["alle", ...POSITIONEN].map((k) => (
          <Link prefetch={false} key={k} href={adresse({ pos: k })}
                className={`kb-sortchip${pos === k ? " kb-sortchip--aktiv" : ""}`}
                aria-current={pos === k ? "true" : undefined}>
            {k === "alle" ? "Gesamt" : k}
          </Link>
        ))}
      </div>
      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Zeitraum" style={{ marginTop: 8 }}>
        {ZEITRAEUME.map((z) => (
          <Link prefetch={false} key={z.schluessel} href={adresse({ zeit: z.schluessel })}
                className={`kb-sortchip${zeit.schluessel === z.schluessel ? " kb-sortchip--aktiv" : ""}`}
                aria-current={zeit.schluessel === z.schluessel ? "true" : undefined}>
            {z.label}
          </Link>
        ))}
      </div>
      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Maß" style={{ marginTop: 8 }}>
        {[["spieler", "je Spieler"], ["mannschaft", "je Mannschaft"]].map(([k, label]) => (
          <Link prefetch={false} key={k} href={adresse({ je: k })}
                className={`kb-sortchip${mass === k ? " kb-sortchip--aktiv" : ""}`}
                aria-current={mass === k ? "true" : undefined}>
            {label}
          </Link>
        ))}
      </div>
      {ansicht === "programm" && (
        <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Wertung" style={{ marginTop: 8 }}>
          {[["beides", "mit eigener Stärke"], ["gegner", "nur Gegner"]].map(([k, label]) => (
            <Link prefetch={false} key={k} href={adresse({ wertung: k })}
                  className={`kb-sortchip${(mitEigener ? "beides" : "gegner") === k ? " kb-sortchip--aktiv" : ""}`}
                  aria-current={(mitEigener ? "beides" : "gegner") === k ? "true" : undefined}>
              {label}
            </Link>
          ))}
        </div>
      )}
      {ansicht === "programm" && (
        <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Vorschau" style={{ marginTop: 8 }}>
          {VORSCHAU.map((n) => (
            <Link prefetch={false} key={n} href={adresse({ vor: String(n) })}
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
                {mitEigener
                  ? <th scope="col" className="kb-aktiv" title={`Eigene Punkte ${einheit} + was die Gegner zulassen − Ligaschnitt, im Schnitt über die nächsten Partien`}>Erwartung</th>
                  : <th scope="col" className="kb-aktiv" title={`Was die nächsten Gegner ${einheit} zulassen, im Schnitt`}>Ø Gegner</th>}
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
                      {r.wert != null ? <strong>{zahl(r.wert)}</strong>
                        : r.gegner.length === 0 ? <span className="kb-gedaempft">–</span>
                        : r.bekannt < r.gegner.length ? <span className="kb-leise">{r.bekannt} von {r.gegner.length} bekannt</span>
                        : <span className="kb-leise">eigene fehlt</span>}
                      {r.wert != null && r.gegner.length < vor && (
                        <span className="kb-leise"> nur {r.gegner.length}</span>
                      )}
                      {/* Woraus die Erwartung besteht — sonst ist sie eine Zahl
                          ohne Herkunft. */}
                      {mitEigener && (
                        <span className="kb-matchupmeine">
                          eigen {zahl(r.eigen)} · Gegner {zahl(r.schnitt)} · Liga {zahl(liga)}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="kb-programm">
                        {r.gegner.map((x) => (
                          <span key={`${x.spieltag}-${x.gegner}`}
                                title={`Spieltag ${x.spieltag}${x.datum ? ` · ${zeitpunkt(x.datum)}` : ""} · ${x.heim ? "zu Hause" : "auswärts"}`}>
                            <span className="kb-leise">{x.heim ? "H" : "A"}</span> {name(x.gegner)}{" "}
                            {(() => {
                              const w = mitEigener ? x.erwartung : x.schnitt;
                              return <span className={w == null ? "kb-gedaempft" : ""}>{zahl(w)}</span>;
                            })()}
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
                        {/* Woraus die Zahl besteht, im Titel: Punkte, Einsätze, Spiele. */}
                        <span title={z.jePosition[k].summe == null ? undefined
                          : `${zahl(z.jePosition[k].summe)} Punkte aus ${z.jePosition[k].einsaetze} Einsätzen in ${z.spiele} Spielen`}>
                          {k === pos ? <strong>{zahl(z.jePosition[k].wert)}</strong> : zahl(z.jePosition[k].wert)}
                        </span>
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
