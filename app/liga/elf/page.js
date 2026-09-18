import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getKader, getSettings, getStartelf } from "@/lib/db";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { holeMitspieler } from "@/lib/mitspieler";
import { bewerteElf } from "@/lib/elfstaerke";
import { zeitpunkt } from "@/lib/format";
import Hinweis from "../../_ui/Hinweis";
import Startelf from "../../_ui/Startelf";

export const dynamic = "force-dynamic";

// Wie stark ist die Elf, die jeder gerade aufgestellt hat?
//
// Je Manager die Summe der Punkteschnitte seiner aufgestellten Spieler,
// daraus eine Tabelle. Alles aus der Datenbank: Aufstellung und Schnitt
// kommen mit dem Kader beim Aktualisieren — die Seite kostet keinen
// einzigen Kickbase-Aufruf über die Mitgliedsprüfung hinaus.
export default async function Elf({ searchParams }) {
  const { token, nutzer, uid: meineUid, name: meinName } = await sitzung();
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

  const settings = await getSettings(leagueId, nutzer);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const manager = await holeMitspieler(leagueId, ranking, settings);
  const kader = await getKader(leagueId);
  const chancen = await getStartelf();

  const zeilen = bewerteElf({ manager, kaderProManager: kader.proManager });
  const meineId = manager.find(
    (m) => (meineUid && String(m.i) === meineUid) || (meinName && m.n === meinName))?.i;

  const mitSumme = zeilen.filter((z) => z.summe != null);
  const luecken = zeilen.reduce((s, z) => s + z.ohneSchnitt, 0);
  const ohneAufstellung = zeilen.length - mitSumme.length;

  const schnitt = (n) => (n == null ? "–" : n.toLocaleString("de-DE", { maximumFractionDigits: 1 }));

  return (
    <main className="kb-seite kb-seite--schmal">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Aufgestellte Elf</h1>
          <p className="kb-unter">
            Summe der Punkteschnitte je aufgestelltem Spieler ·
            {kader.stand ? ` Kader vom ${zeitpunkt(kader.stand)}` : " noch kein Kader geladen"}
          </p>
        </div>
      </header>

      <Hinweis kurz="Wie die Zahl entsteht" titel="Aufgestellte Elf nach Punkteschnitt">
        <p>
          Für jeden Manager wird die <strong>Aufstellung aus dem gespeicherten Kader</strong>{" "}
          genommen — so, wie er sie beim letzten Aktualisieren stehen hatte — und für jeden
          aufgestellten Spieler sein <strong>Punkteschnitt je Spiel</strong> der bisherigen
          Saison aufsummiert. Das ist keine Prognose, sondern eine Momentaufnahme: Hätten alle
          wie bisher gepunktet, stünde diese Elf bei dieser Zahl.
        </p>
        <p>
          <strong>Was fehlt, fehlt sichtbar.</strong> Ein Spieler ohne Schnitt (noch kein
          Einsatz, oder Kickbase liefert keinen) zählt als 0 und steht als Lücke daneben —
          eine zu niedrige Summe sähe sonst aus wie eine schwache Elf statt wie eine
          Datenlücke. Wer keine Aufstellung gespeichert hat, steht ohne Zahl am Ende.
        </p>
        <p>
          Die Aufstellung ist so alt wie der letzte Aktualisieren-Lauf. Wer seine Elf seither
          geändert hat, steht hier noch mit der alten. Die Zahl kostet keinen
          Kickbase-Aufruf: Schnitt und Aufstellung kommen mit dem Kader.
        </p>
      </Hinweis>

      {(luecken > 0 || ohneAufstellung > 0) && (
        <div className="kb-hinweis kb-hinweis--warn">
          {luecken > 0 && <>{luecken} aufgestellte {luecken === 1 ? "Spieler hat" : "Spieler haben"} keinen Schnitt und {luecken === 1 ? "zählt" : "zählen"} als 0. </>}
          {ohneAufstellung > 0 && <>{ohneAufstellung} Manager ohne gespeicherte Aufstellung — einmal aktualisieren.</>}
        </div>
      )}

      {zeilen.length === 0 ? (
        <p className="kb-info">Noch keine Manager bekannt — einmal aktualisieren.</p>
      ) : (
        <div className="kb-tabellenrahmen">
          <table className="kb-tabelle kb-tabelle--schmal">
            <thead>
              <tr>
                <th>#</th>
                <th className="kb-namensspalte">Manager</th>
                <th>Schnitt-Summe</th>
                <th>Aufgestellt</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z, i) => (
                <tr key={z.id}
                    className={`${i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}${String(z.id) === String(meineId) ? " kb-zeile--ich" : ""}`}>
                  <td>{z.rang ?? "–"}</td>
                  <td className="kb-namensspalte">
                    {/* Die Elf zum Aufklappen: wer trägt wie viel bei. Der Name
                        selbst ist kein Link — ein Tipp darauf soll aufklappen,
                        nicht wegnavigieren; zur Managerseite geht es darunter. */}
                    <details>
                      <summary className="kb-spielername kb-aufklappzeile">{z.name}</summary>
                      <p className="kb-leise" style={{ margin: "4px 0" }}>
                        <Link href={`/liga/manager/${z.id}?league=${leagueId}`}>Managerseite →</Link>
                      </p>
                      {z.elf.length === 0 ? (
                        <p className="kb-leise">Keine Aufstellung gespeichert.</p>
                      ) : (
                        <table className="kb-liste kb-elfliste">
                          <tbody>
                            {z.elf.map((s) => (
                              <tr key={s.id}>
                                <td>
                                  {s.name} <span className="kb-leise">{s.position ?? ""}</span>{" "}
                                  <Startelf wert={chancen.get(String(s.id)) ?? null} />
                                </td>
                                <td className={s.schnitt == null ? "kb-gedaempft" : undefined}>
                                  {s.schnitt == null ? "kein Schnitt" : schnitt(s.schnitt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </details>
                  </td>
                  <td>
                    {z.summe == null ? <span className="kb-gedaempft">–</span> : <strong>{schnitt(z.summe)}</strong>}
                    {z.ohneSchnitt > 0 && (
                      <span className="kb-warntext" title={`${z.ohneSchnitt} ohne Schnitt, zählen als 0`}>
                        {" "}({z.ohneSchnitt} Lücke{z.ohneSchnitt === 1 ? "" : "n"})
                      </span>
                    )}
                  </td>
                  <td>
                    {z.aufgestellt}
                    <span className="kb-leise"> von {z.kader}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="kb-legende">
        Punkteschnitt = Punkte je Spiel dieser Saison, wie Kickbase ihn im Kader mitliefert.
        Der Name klappt die Elf auf; der Rang teilt sich bei gleicher Summe.
      </p>
    </main>
  );
}
