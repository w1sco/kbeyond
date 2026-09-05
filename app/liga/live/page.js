import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { verlangeLiga, sitzung } from "@/lib/auth";
import { initSchema, getKader, getSettings, getStartelf } from "@/lib/db";
import { holeMitspieler } from "@/lib/mitspieler";
import { holeNamen } from "@/lib/spielernamen";
import {
  holeLivestand, bekannterLivePfad, gespeicherteSpielerPunkte,
} from "@/lib/liveabruf";
import { zeitpunkt, posRang, normalisiereSpieler } from "@/lib/format";
import Hinweis from "@/app/_ui/Hinweis";
import Auffrischen from "./Auffrischen";
import Startelf from "@/app/_ui/Startelf";

export const dynamic = "force-dynamic";

// Live-Punkte am Spieltag: was die Elf jedes Managers gerade holt.
//
// Ein Kickbase-Aufruf je Seitenaufruf (der gemerkte Live-Endpunkt) plus die
// Rangliste. Kader und Aufstellung kommen aus der Datenbank — die stehen
// dort schon und kosten nichts.
export default async function Live({ searchParams }) {
  const { token, nutzer } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);
  await initSchema();

  const [ranking, settings, kader, merkzettel] = await Promise.all([
    kbFetch(`/v4/leagues/${leagueId}/ranking`, token),
    getSettings(leagueId, nutzer),
    getKader(leagueId),
    bekannterLivePfad(),
  ]);

  const manager = await holeMitspieler(leagueId, ranking, settings);

  // Anker für die Spielersuche: welche Spieler gehören wem?
  const kaderIds = new Map(
    manager.map((m) => [String(m.i), (kader.proManager.get(String(m.i)) ?? []).map((s) => s.id)])
  );

  const live = merkzettel?.pfad
    ? await holeLivestand(leagueId, token, manager.map((m) => String(m.i)), kaderIds)
    : null;

  // Namen für Spieler, die der gespeicherte Kader nicht kennt. Kostet
  // keinen Kickbase-Aufruf — Pool und Events stehen in der Datenbank.
  const namen = live?.aufstellung?.size ? await holeNamen(leagueId) : new Map();

  // Einzelpunkte aus dem letzten Hol-Lauf. Sie stehen in der Datenbank und
  // kosten hier nichts; geholt werden sie nur auf Klick.
  const gespeichert = live && !live.spieler?.size
    ? await gespeicherteSpielerPunkte(leagueId)
    : null;

  const elf = await getStartelf();

  const zeilen = manager
    .map((m) => {
      const id = String(m.i);
      const kaderListe = kader.proManager.get(id) ?? [];
      const nachId = new Map(kaderListe.map((s) => [String(s.id), s]));
      const proSpieler =
        live?.spieler?.get(id) ?? gespeichert?.proManager?.get(id) ?? null;

      // Die Spieler kommen aus der **Live-Antwort**, nicht aus dem Kader:
      // Kickbase weiß am besten, wer heute für diesen Manager punktet.
      // Name und Position steuert der gespeicherte Kader bei; kennt er den
      // Spieler nicht (frisch gekauft, Kader noch nicht aktualisiert),
      // stehen sie in der Antwort selbst.
      // Die Aufstellung aus der Live-Antwort ist die **aktuelle** — unser
      // gespeicherter Kader kann einen Tag alt sein.
      const liveElf = live?.aufstellung?.get(id) ?? null;

      const bau = (spielerId, punkte) => {
        const bekannt = nachId.get(spielerId);
        return {
          id: spielerId,
          name: bekannt?.name ?? namen.get(spielerId) ?? `Spieler #${spielerId}`,
          position: bekannt?.position ?? null,
          startelf: elf.get(spielerId) ?? null,
          // In der Live-Aufstellung stehen heißt aufgestellt. Ohne diese
          // Liste bleibt nur unser Kader — und wen der nicht kennt, der
          // bekommt kein Zeichen statt eines geratenen.
          aufgestellt: liveElf ? true : bekannt ? bekannt.aufgestellt : null,
          punkte,
        };
      };

      const spieler = proSpieler
        ? [...proSpieler].map(([spielerId, eintrag]) => {
            const gebaut = bau(spielerId, eintrag.punkte);
            if (gebaut.name.startsWith("Spieler #") && eintrag.roh) {
              const ausAntwort = normalisiereSpieler(eintrag.roh);
              if (ausAntwort.name !== "Unbekannt") gebaut.name = ausAntwort.name;
              gebaut.position = gebaut.position ?? ausAntwort.position;
            }
            return gebaut;
          })
        : liveElf
          ? // Ohne Einzelpunkte wenigstens die echte, aktuelle Elf.
            liveElf.map((spielerId) => bau(spielerId, null))
          : kaderListe
              .filter((s) => s.aufgestellt)
              .map((s) => ({ ...s, id: String(s.id), punkte: null, aufgestellt: true }));

      spieler.sort(
        (a, b) =>
          (b.punkte ?? -1) - (a.punkte ?? -1) ||
          posRang(a.position) - posRang(b.position) ||
          a.name.localeCompare(b.name, "de")
      );

      // Kickbases eigene Zahl gewinnt. Die Summe der Spieler ist nur
      // Ersatz, wenn der Endpunkt für diesen Manager nichts meldet.
      const gemeldet = live?.punkte?.get(id);
      const ausSpielern = proSpieler
        ? [...proSpieler.values()].reduce((sum, e) => sum + e.punkte, 0)
        : null;

      return {
        id,
        name: m.n,
        punkte: gemeldet ?? ausSpielern,
        spieler,
        // Wie viele Spieler die Antwort für ihn führt – nicht dasselbe wie
        // die Kadergröße, und genau deshalb einen eigenen Wert wert.
        gezaehlt: proSpieler?.size ?? liveElf?.length ?? null,
        ausAntwort: Boolean(proSpieler || liveElf),
        ausSpielern,
        gemeldet: gemeldet ?? null,
        aufgestellt: kaderListe.filter((s) => s.aufgestellt).length,
        saison: Number(m.sp ?? 0),
      };
    })
    .sort((a, b) => (b.punkte ?? -1) - (a.punkte ?? -1));

  // Rang nach Saisonpunkten — daran misst sich, wer heute gutmacht.
  const saisonRang = new Map(
    [...zeilen].sort((a, b) => b.saison - a.saison).map((z, i) => [z.id, i + 1])
  );

  const mitWerten = zeilen.filter((z) => z.punkte != null);
  const fuehrend = mitWerten[0]?.punkte ?? 0;
  const schnitt = mitWerten.length
    ? Math.round(mitWerten.reduce((s, z) => s + z.punkte, 0) / mitWerten.length)
    : null;
  const jeSpieler =
    (live?.spieler?.size ?? 0) > 0 || (gespeichert?.proManager?.size ?? 0) > 0;
  const pfadBekannt = Boolean(merkzettel?.spielerPfad);

  // Bester Spieler der ganzen Liga — die Frage, die man am Spieltag als
  // Erstes stellt.
  const besterSpieler = zeilen
    .flatMap((z) => z.spieler.map((s) => ({ ...s, manager: z.name })))
    .filter((s) => s.punkte != null)
    .sort((a, b) => b.punkte - a.punkte)[0] ?? null;

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Live-Punkte</h1>
          <p className="kb-unter">
            {ranking?.ti ?? "Liga"} · {zeilen.length} Manager
            {live?.stand ? ` · Stand ${zeitpunkt(live.stand)}` : ""}
          </p>
        </div>
        <Auffrischen />
      </header>

      {p.live && <div className="kb-hinweis kb-hinweis--gut">{p.live}</div>}
      {p.fehler && <div className="kb-hinweis kb-hinweis--fehler">Fehler: {p.fehler}</div>}

      {!merkzettel?.pfad ? (
        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">Endpunkt noch nicht bestimmt</h2>
          <p>
            Wo Kickbase die Live-Punkte ausliefert, ist nicht dokumentiert. Einmal suchen
            genügt — danach kostet diese Seite einen einzigen Aufruf. Gefunden wird nur
            etwas, <strong>während ein Spieltag läuft</strong>.
          </p>
          <form method="POST" action={`/api/live?league=${leagueId}&zurueck=1`}>
            <button className="kb-btn" type="submit">Endpunkt suchen</button>
          </form>
          <p className="kb-leise" style={{ marginTop: 8 }}>
            Was dabei geprüft wird, zeigt{" "}
            <Link href={`/livepunkte?league=${leagueId}`}>die Diagnoseseite</Link>.
          </p>
        </section>
      ) : live?.fehler ? (
        <section className="kb-karte">
          <div className="kb-hinweis kb-hinweis--warn">
            Der gemerkte Endpunkt <code>{live.pfad}</code> liefert gerade keine Punkte:{" "}
            {live.fehler}. Zwischen zwei Spieltagen ist das normal.
          </div>
          <form method="POST" action={`/api/live?league=${leagueId}&zurueck=1`}>
            <button className="kb-btn kb-btn--klein" type="submit">Neu suchen</button>
          </form>
        </section>
      ) : (
        <>
          <div className="kb-kennzahlen">
            <div>
              <span className="kb-label">Bester Manager</span>
              <strong>{fuehrend}</strong>
            </div>
            <div>
              <span className="kb-label">Ligaschnitt</span>
              <strong>{schnitt ?? "–"}</strong>
            </div>
            <div>
              <span className="kb-label">Mit Live-Wert</span>
              <strong>{mitWerten.length} von {zeilen.length}</strong>
            </div>
            {besterSpieler && (
              <div>
                <span className="kb-label">Bester Spieler</span>
                <strong>{besterSpieler.name} · {besterSpieler.punkte}</strong>
                <span className="kb-leise kb-unterzeile">{besterSpieler.manager}</span>
              </div>
            )}
          </div>

          {!jeSpieler && (
            <Hinweis
              art="warn"
              titel="Aufstellung ja, Einzelpunkte nein"
              kurz="Der Endpunkt meldet Punkte je Manager und die Elf — aber keine Punkte je Spieler."
            >
              Gesucht wurde auf drei Wegen: im Eintrag jedes Managers nach einer Liste mit
              Spieler-IDs und Punkten, in der ganzen Antwort nach den Spieler-IDs aus der
              Aufstellung, und nach denen aus den gespeicherten Kadern. Alle drei bleiben
              leer — diese Antwort trägt die Punkte nur je Manager. Für die Einzelpunkte
              bräuchte es einen <strong>zweiten Endpunkt</strong>; welcher das ist, ist
              noch nicht belegt.
              {" "}Der Kasten darunter zeigt den Aufbau der Antwort, die gerade vorliegt.
            </Hinweis>
          )}

          {(!jeSpieler || pfadBekannt) && (
            <form
              method="POST"
              action={`/api/live?league=${leagueId}&zurueck=1${pfadBekannt ? "&punkte=1" : ""}`}
              style={{ marginBottom: 12 }}
            >
              <button className="kb-btn kb-btn--klein" type="submit">
                {pfadBekannt ? "Einzelpunkte holen" : "Nach Einzelpunkten suchen"}
              </button>
              <span className="kb-leise">
                {pfadBekannt
                  ? ` · ein Aufruf je Manager (${zeilen.length})`
                  : " · probiert einige Endpunkte durch, wenige Aufrufe"}
                {gespeichert?.stand ? ` · zuletzt ${zeitpunkt(gespeichert.stand)}` : ""}
              </span>
            </form>
          )}

          {!jeSpieler && live?.probe && (
            <details className="kb-karte">
              <summary>
                Woran liegt es? — ein Managereintrag im Rohzustand
              </summary>
              <p className="kb-leise">
                Das ist die Antwort, die gerade vorliegt. Sie kostet keinen
                zusätzlichen Aufruf. Daran lässt sich ablesen, unter welchem Feld die
                Einzelpunkte stehen — oder ob sie gar nicht mitkommen.
              </p>
              <pre className="kb-roh">
                {JSON.stringify(live.probe.eintrag, null, 2).slice(0, 2500)}
              </pre>
              <p className="kb-leise">Aufbau der ganzen Antwort:</p>
              <pre className="kb-roh">
                {live.probe.baum.map((z) => `${z.pfad} = ${z.wert}`).join("\n")}
              </pre>
            </details>
          )}

          <div className="kb-tabellenrahmen">
            <table className="kb-tabelle kb-livetabelle">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="kb-namensspalte">Manager</th>
                  <th>Live</th>
                  <th>Rückstand</th>
                  <th className="kb-sek">Spieler</th>
                  <th className="kb-sek">Saison</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z, i) => {
                  const bewegung = saisonRang.get(z.id) - (i + 1);
                  return (
                    <tr key={z.id}>
                      <td>{i + 1}</td>
                      <td className="kb-namensspalte">
                        <details className="kb-elfauf">
                          <summary>
                            {z.name}
                            {bewegung !== 0 && (
                              <span className={bewegung > 0 ? "kb-plus" : "kb-minus"}>
                                {" "}{bewegung > 0 ? "▲" : "▼"}{Math.abs(bewegung)}
                              </span>
                            )}
                          </summary>
                          <ul className="kb-elfliste">
                            {z.spieler.length === 0 && (
                              <li className="kb-leise">Keine Spieler gemeldet</li>
                            )}
                            {z.spieler.map((s) => (
                              <li key={s.id}>
                                {/* ● aufgestellt, ○ nicht – wie auf der
                                    Managerseite. Wen der gespeicherte
                                    Kader nicht kennt, bekommt kein
                                    Zeichen statt eines geratenen. */}
                                <span className="kb-leise" title={
                                  s.aufgestellt === null
                                    ? "nicht im gespeicherten Kader"
                                    : s.aufgestellt ? "aufgestellt" : "Bank"
                                }>
                                  {s.aufgestellt === null ? "·" : s.aufgestellt ? "●" : "○"}
                                </span>
                                <span className="kb-leise">{s.position ?? "?"}</span>
                                <span className="kb-livename">{s.name}</span>
                                <Startelf wert={s.startelf} />
                                {s.punkte != null && <strong>{s.punkte}</strong>}
                              </li>
                            ))}
                          </ul>
                          {z.gemeldet != null && z.ausSpielern != null &&
                           z.gemeldet !== z.ausSpielern && (
                            <p className="kb-leise">
                              Summe der Spieler: {z.ausSpielern} — Kickbase meldet {z.gemeldet}.
                              Angezeigt wird Kickbases Zahl.
                            </p>
                          )}
                          <Link href={`/liga/manager/${z.id}?league=${leagueId}`}>
                            → Managerseite
                          </Link>
                        </details>
                      </td>
                      <td><strong>{z.punkte ?? "–"}</strong></td>
                      <td className="kb-leise">
                        {z.punkte == null
                          ? "–"
                          : z.punkte === fuehrend
                            ? "—"
                            : `−${fuehrend - z.punkte}`}
                      </td>
                      <td className="kb-sek">{z.gezaehlt ?? z.aufgestellt}</td>
                      <td className="kb-sek kb-leise">{z.saison}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="kb-info">
            Punkte aus <code>{live.pfad}</code>, Feld <code>{live.punkteFeld}</code>.
            Aufstellung und Kader stammen aus der Datenbank — wer seine Elf seit dem letzten
            Aktualisieren geändert hat, steht hier noch mit der alten.
          </p>
        </>
      )}
    </main>
  );
}
