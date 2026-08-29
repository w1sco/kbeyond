import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { verlangeLiga, sitzung } from "@/lib/auth";
import { initSchema, getKader, getSettings } from "@/lib/db";
import { holeMitspieler } from "@/lib/mitspieler";
import { holeLivestand, bekannterLivePfad } from "@/lib/liveabruf";
import { zeitpunkt, posRang } from "@/lib/format";
import Hinweis from "@/app/_ui/Hinweis";
import Auffrischen from "./Auffrischen";

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

  const zeilen = manager
    .map((m) => {
      const id = String(m.i);
      const alle = kader.proManager.get(id) ?? [];
      const elf = alle.filter((s) => s.aufgestellt);
      const bank = alle.filter((s) => !s.aufgestellt);
      const proSpieler = live?.spieler?.get(id) ?? null;

      const punkteVon = (s) => (proSpieler?.has(s.id) ? proSpieler.get(s.id) : null);
      const summe = (liste) => {
        const werte = liste.map(punkteVon).filter((n) => n != null);
        return werte.length ? werte.reduce((a, b) => a + b, 0) : null;
      };

      // Kickbases eigene Zahl gewinnt. Die Summe der Elf ist nur Ersatz,
      // wenn der Endpunkt für diesen Manager nichts meldet.
      const gemeldet = live?.punkte?.get(id);

      return {
        id,
        name: m.n,
        punkte: gemeldet ?? summe(elf),
        elf: elf
          .map((s) => ({ ...s, live: punkteVon(s) }))
          .sort(
            (a, b) => (b.live ?? -1) - (a.live ?? -1) || posRang(a.position) - posRang(b.position)
          ),
        bankPunkte: summe(bank),
        aufgestellt: elf.length,
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
  const jeSpieler = (live?.spieler?.size ?? 0) > 0;

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
          </div>

          {!jeSpieler && (
            <Hinweis
              art="warn"
              titel="Nur Managersummen, keine Einzelspieler"
              kurz="Der Endpunkt meldet Punkte je Manager, aber keine je Spieler."
            >
              In der Antwort findet sich keine Liste, in der die Spieler-IDs aus den
              gespeicherten Kadern mit Punkten stehen. Die Aufklappzeile zeigt deshalb die
              Aufstellung ohne Einzelpunkte. Welche Felder die Antwort tatsächlich führt,
              steht auf <Link href={`/livepunkte?league=${leagueId}`}>der Diagnoseseite</Link>.
            </Hinweis>
          )}

          <div className="kb-tabellenrahmen">
            <table className="kb-tabelle kb-livetabelle">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="kb-namensspalte">Manager</th>
                  <th>Live</th>
                  <th>Rückstand</th>
                  <th className="kb-sek">Elf</th>
                  <th className="kb-sek">Bank</th>
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
                            {z.elf.length === 0 && (
                              <li className="kb-leise">Keine Aufstellung gespeichert</li>
                            )}
                            {z.elf.map((s) => (
                              <li key={s.id}>
                                <span className="kb-leise">{s.position}</span> {s.name}
                                {s.live != null && <strong>{s.live}</strong>}
                              </li>
                            ))}
                          </ul>
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
                      <td className="kb-sek">{z.aufgestellt}</td>
                      <td className="kb-sek kb-leise">{z.bankPunkte ?? "–"}</td>
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
