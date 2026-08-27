import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { findeSpielerListe } from "@/lib/format";
import { findeAufstellung, felderAnalyse, ELF } from "@/lib/aufstellung";
import { DiagnoseKopf, LigaFehlt, probiere, Ergebnisse, Rohdaten } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

// Warum diese Seite: Die Startelf steckt irgendwo in den Kaderdaten, aber
// unter welchem Feld, ist nicht dokumentiert. Statt zu raten zeigt diese
// Seite die Rohdaten **und** was die Erkennung darin sieht — samt der
// Felder, die knapp danebenliegen. Damit ist ein Fehlgriff in einer Runde
// behoben statt in fünf.
export default async function AufstellungDiagnose({ searchParams }) {
  const { token, uid: meineUid } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) return <LigaFehlt titel="Aufstellung: woran erkennt man die Startelf?" />;

  await verlangeLiga(leagueId, token);

  let uid = p.uid ?? meineUid ?? null;
  let woher = "aus der Adresse";
  if (!uid) {
    try {
      const rang = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
      uid = String((rang.us ?? [])[0]?.i ?? "");
      woher = "erster Manager der Rangliste";
    } catch {
      // dann eben ohne
    }
  }

  // Eigene Endpunkte für die Aufstellung – falls es sie gibt, sind sie die
  // bessere Quelle als jede Felderkennung.
  const eigene = uid
    ? await probiere(
        [
          `/v4/leagues/${leagueId}/lineup`,
          `/v4/leagues/${leagueId}/managers/${uid}/lineup`,
          `/v4/leagues/${leagueId}/lineup/${uid}`,
          `/v4/leagues/${leagueId}/managers/${uid}/teamcenter`,
        ],
        token
      )
    : [];

  // Der Kader – hier soll die Startelf drinstecken.
  let roh = null;
  let fehler = null;
  try {
    roh = await kbFetch(`/v4/leagues/${leagueId}/managers/${uid}/squad`, token);
  } catch (e) {
    fehler = e.message;
  }

  const liste = roh ? findeSpielerListe(roh) : [];
  const gefunden = liste.length ? findeAufstellung(liste) : null;
  const analyse = liste.length ? felderAnalyse(liste) : [];

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Aufstellung: woran erkennt man die Startelf?"
        unter={`Manager ${uid || "–"} (${woher}) · ${liste.length} Spieler im Kader`}
        leagueId={leagueId}
      />

      {fehler && <div className="kb-hinweis kb-hinweis--fehler">Kader nicht abrufbar: {fehler}</div>}

      <div className={`kb-hinweis ${gefunden ? "kb-hinweis--gut" : "kb-hinweis--warn"}`}>
        {gefunden
          ? `Erkannt: ${gefunden.drin.filter(Boolean).length} von ${liste.length} Spielern` +
            (gefunden.feld ? ` über das Feld „${gefunden.feld}" (${gefunden.art})` : ` — ${gefunden.art}`)
          : `Keine Aufstellung erkannt. Unten steht, welche Felder es gibt und was ihnen zu ${ELF} Treffern fehlt.`}
      </div>

      <p className="kb-info">
        Anderen Manager prüfen: <code>?league={leagueId}&uid=…</code> ·{" "}
        <Link href={`/liga?league=${leagueId}`}>zurück zur Liga</Link>
      </p>

      <section style={{ marginTop: 18 }}>
        <h2 className="kb-abschnitt-titel">1 · Eigene Endpunkte für die Aufstellung</h2>
        <p className="kb-info">
          Gibt es einen, brauchen wir keine Felderkennung mehr.
        </p>
        {eigene.length === 0 ? (
          <p className="kb-info">Kein Manager bekannt — ohne <code>uid</code> nicht prüfbar.</p>
        ) : (
          <Ergebnisse ergebnisse={eigene} />
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 className="kb-abschnitt-titel">
          2 · Die Felder im Kader
          <span className="kb-leise"> was passt, was nicht</span>
        </h2>

        {liste.length === 0 ? (
          <p className="kb-info">Keine auswertbare Spielerliste in der Antwort.</p>
        ) : (
          <div className="kb-tabellenrahmen">
            <table className="kb-tabelle kb-tabelle--schmal">
              <thead>
                <tr>
                  <th className="kb-namensspalte">Feld</th>
                  <th>verschiedene Werte</th>
                  <th>Beispiele</th>
                  <th>passt als</th>
                </tr>
              </thead>
              <tbody>
                {analyse.map((a, i) => (
                  <tr key={a.feld} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                    <td className="kb-namensspalte">
                      <code>{a.feld}</code>
                      {a.gesperrt && <span className="kb-leise"> gesperrt</span>}
                    </td>
                    <td>{a.verschieden}</td>
                    <td className="kb-leise">{a.beispiele.join(", ").slice(0, 60)}</td>
                    <td className={a.treffer.length ? "kb-plus" : "kb-gedaempft"}>
                      {a.treffer.length ? a.treffer.join(", ") : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 className="kb-abschnitt-titel">
          3 · Ein Spieler im Rohzustand
          <span className="kb-leise"> alle Felder, wie sie kommen</span>
        </h2>
        {liste[0] ? <Rohdaten daten={liste[0]} /> : <p className="kb-info">Kein Spieler vorhanden.</p>}
      </section>
    </main>
  );
}
