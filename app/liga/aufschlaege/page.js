import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings } from "@/lib/db";
import { euro, prozent } from "@/lib/format";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { holeAufschlaege } from "@/lib/marktbeobachtung";
import { werteAus, proManager, ZEITRAEUME, zeitraumAb, HERKUNFT, filtereHerkunft } from "@/lib/aufschlag";
import Hinweis from "../../_ui/Hinweis";

export const dynamic = "force-dynamic";

// Eigene Seite, weil die Aufschläge eigene Filter mitbringen (Herkunft,
// Zeitraum). Auf der Ligaseite belegten sie deren URL und schoben die
// Tabelle nach unten – und die ist das Werkzeug, das man zuerst sehen will.
export default async function Aufschlaege({ searchParams }) {
  const { token } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;

  await verlangeLiga(leagueId, token);
  await initSchema();

  const settings = await getSettings(leagueId);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);

  const zeitraum = ZEITRAEUME.some((z) => z.schluessel === p.auf) ? p.auf : "reset";
  const aufschlagZeilen = await holeAufschlaege(
    leagueId,
    settings.stichtag,
    zeitraumAb(zeitraum, settings.stichtag)
  );
  // Marktkäufe und Deals zwischen Mitspielern folgen unterschiedlicher
  // Logik und gehören nicht in denselben Durchschnitt.
  const herkunft = HERKUNFT.some((h) => h.schluessel === p.her) ? p.her : "markt";
  const gefilterteKaeufe = filtereHerkunft(aufschlagZeilen, herkunft);

  const aufLiga = werteAus(gefilterteKaeufe);
  const aufManager = proManager(gefilterteKaeufe);

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Aufschläge · {ranking.ti}</h1>
          <p className="kb-unter">Was über dem Marktwert gezahlt wurde.</p>
        </div>
      </header>

      <section className="kb-karte">
        <div className="kb-sortleiste kb-sortleiste--immer">
          {HERKUNFT.map((h) => (
            <a
              key={h.schluessel}
              href={`/liga/aufschlaege?league=${leagueId}&auf=${zeitraum}&her=${h.schluessel}`}
              className={`kb-sortchip${herkunft === h.schluessel ? " kb-sortchip--aktiv" : ""}`}
            >
              {h.label}
            </a>
          ))}
        </div>

        <div className="kb-sortleiste kb-sortleiste--immer">
          {ZEITRAEUME.map((z) => (
            <a
              key={z.schluessel}
              href={`/liga/aufschlaege?league=${leagueId}&auf=${z.schluessel}&her=${herkunft}`}
              className={`kb-sortchip${zeitraum === z.schluessel ? " kb-sortchip--aktiv" : ""}`}
            >
              {z.label}
            </a>
          ))}
        </div>

        {aufLiga.anzahl === 0 ? (
          <p className="kb-info">
            In diesem Zeitraum kein Kauf, dem sich ein Marktwert zuordnen lässt.
            {aufLiga.ohneWert > 0 && ` (${aufLiga.ohneWert} Käufe ohne bekanntes Angebot)`}
          </p>
        ) : (
          <>
            <div className="kb-kennzahlen">
              <div>
                <span className="kb-label">Ø Aufschlag der Liga</span>
                <strong className={aufLiga.schnitt > 0 ? "kb-minus" : "kb-plus"}>
                  {aufLiga.schnitt > 0 ? "+" : ""}{euro(Math.round(aufLiga.schnitt))}
                </strong>
              </div>
              <div>
                <span className="kb-label">Ø relativ</span>
                <strong className={aufLiga.relativ > 0 ? "kb-minus" : "kb-plus"}>
                  {aufLiga.relativ > 0 ? "+" : ""}{prozent(aufLiga.relativ)}
                </strong>
              </div>
              <div>
                <span className="kb-label">Gewertete Käufe</span>
                {aufLiga.anzahl}
                {aufLiga.ohneWert > 0 && <span className="kb-leise"> · {aufLiga.ohneWert} ohne Marktwert</span>}
              </div>
              <div>
                <span className="kb-label">Summe über Marktwert</span>
                {euro(Math.round(aufLiga.gesamtsumme))}
              </div>
            </div>

            <div className="kb-tabellenrahmen" style={{ marginTop: 14 }}>
              <table className="kb-tabelle kb-tabelle--schmal">
                <thead>
                  <tr>
                    <th className="kb-namensspalte">Manager</th>
                    <th>Bewertet</th>
                    <th>Ø Aufschlag</th>
                    <th>Ø relativ</th>
                  </tr>
                </thead>
                <tbody>
                  {aufManager.map((m, i) => (
                    <tr key={m.name} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                      <td className="kb-namensspalte">
                        <span className="kb-spielername">{m.name}</span>
                      </td>
                      <td>
                        {m.anzahl}
                        <span className="kb-leise"> von {m.gesamt}</span>
                      </td>
                      <td className={m.schnitt > 0 ? "kb-minus" : "kb-plus"}>
                        {m.schnitt > 0 ? "+" : ""}{euro(Math.round(m.schnitt))}
                      </td>
                      <td className={m.relativ > 0 ? "kb-minus" : "kb-plus"}>
                        {m.relativ > 0 ? "+" : ""}{prozent(m.relativ)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Hinweis kurz="Wie der Aufschlag gerechnet wird" titel="Aufschlag über Marktwert">
          <p>
            Der Aufschlag eines Kaufs ist <strong>Kaufpreis minus Marktwert zum Zeitpunkt
            des Angebots</strong> — nicht der Marktwert von heute. Sonst würde jede spätere
            Marktwertänderung den Aufschlag verfälschen.
          </p>
          <p>
            Der Marktwert kommt aus drei Quellen, in dieser Reihenfolge: dem Feed-Event
            „Spieler neu am Markt“, der eigenen Mitschrift des Transfermarkts und der
            <strong> Marktwert-Historie des Spielers</strong>. Die dritte trägt auch Käufe,
            deren Angebot längst aus dem Feed-Fenster gefallen ist — ohne sie erschien ein
            Manager mit 11 Spielern hier mit 7 Käufen.
          </p>
          <p>
            Die Historien werden bei „Alles aktualisieren“ nachgeladen, und zwar nur für
            Käufe, denen die Bezugsgröße noch fehlt. Bleibt die Zahl hinter „ohne
            Marktwert“ hoch, hat Kickbase für diese Spieler keine Historie geliefert; was
            der Abruf zurückgibt, zeigt die{" "}
            <a href={`/marktwert?league=${leagueId}`}>Marktwert-Diagnose</a> — sie probiert
            alle Kandidaten durch und sagt, welcher eine Reihe aus Datum und Wert liefert.
          </p>
          <p>
            Käufe ohne jede Bezugsgröße bleiben außen vor und werden separat gezählt — ein
            Durchschnitt aus der Hälfte der Käufe soll nicht aussehen, als käme er aus allen.
          </p>
          <p>
            <strong>Ø relativ</strong> gewichtet jeden Kauf gleich. Sonst bestimmte ein
            einziger teurer Spieler die Quote der ganzen Liga.
          </p>
          <p>
            <strong>Vom Markt oder von Mitspielern</strong> — das sind zwei verschiedene
            Dinge. Beim Markt bietet man über den Marktwert, um den Zuschlag zu bekommen;
            bei einem Mitspieler wird verhandelt, und der Preis hat mit dem Marktwert oft
            wenig zu tun. In einen Topf geworfen ergibt der Durchschnitt keine Aussage,
            deshalb die Umschaltung oben.
          </p>
          <p>
            <strong>„Bewertet&ldquo;</strong> sagt, auf wie vielen Käufen der Durchschnitt beruht
            und wie viele es insgesamt gab. Steht dort „7 von 11&ldquo;, ist der Wert ein
            Ausschnitt — vergleiche ihn nicht ungeprüft mit einem Manager, bei dem alle
            Käufe bewertet sind.
          </p>
        </Hinweis>
      </section>
    </main>
  );
}
