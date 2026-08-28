import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { findeSpielerListe } from "@/lib/format";
import { findeAufstellung, felderAnalyse, elfAus, schluesselBaum } from "@/lib/aufstellung";
import { DiagnoseKopf, LigaFehlt, Rohdaten } from "../_diagnose/Endpunkte";
import { nurMitspieler } from "@/lib/manager";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Die eine Frage, um die es hier geht:
// **Gibt Kickbase die Aufstellung FREMDER Manager heraus?**
//
// In der App sieht man sie — also muss es einen Weg geben. Ein Endpunkt,
// der antwortet, beweist aber noch nichts: `/lineup?uid=…` antwortet für
// jeden Manager und liefert trotzdem immer dieselbe Elf, nämlich die
// eigene. Deshalb wird hier nicht nur gefragt, ob etwas kommt, sondern
// **ob für zwei verschiedene Manager Verschiedenes kommt**.
const KANDIDATEN = (liga, uid) => [
  // Parametervarianten am belegten Endpunkt
  `/v4/leagues/${liga}/lineup?uid=${uid}`,
  `/v4/leagues/${liga}/lineup?u=${uid}`,
  `/v4/leagues/${liga}/lineup?userId=${uid}`,
  `/v4/leagues/${liga}/lineup?managerId=${uid}`,
  `/v4/leagues/${liga}/lineup?user=${uid}`,
  `/v4/leagues/${liga}/lineup/${uid}`,

  // Der Weg über den Manager
  `/v4/leagues/${liga}/managers/${uid}/lineup`,
  `/v4/leagues/${liga}/managers/${uid}/lineup/current`,
  `/v4/leagues/${liga}/managers/${uid}/team`,
  `/v4/leagues/${liga}/managers/${uid}/teamcenter`,
  `/v4/leagues/${liga}/managers/${uid}/matchday`,
  `/v4/leagues/${liga}/managers/${uid}/matchdays`,
  `/v4/leagues/${liga}/managers/${uid}/performance`,
  `/v4/leagues/${liga}/managers/${uid}/dashboard`,
  `/v4/leagues/${liga}/managers/${uid}/squad?lineup=1`,

  // Andere Schreibweisen für „Nutzer"
  `/v4/leagues/${liga}/users/${uid}/lineup`,
  `/v4/leagues/${liga}/user/${uid}/lineup`,
  `/v4/leagues/${liga}/teams/${uid}/lineup`,
  `/v4/leagues/${liga}/teamcenter/${uid}`,
  `/v4/leagues/${liga}/teamcenter?uid=${uid}`,

  // Spieltagsbezogen — in der App hängt die Aufstellung am Spieltag
  `/v4/leagues/${liga}/matchday`,
  `/v4/leagues/${liga}/matchdays`,
  `/v4/leagues/${liga}/managers/${uid}/season`,
];

// Kurzform einer Elf, um zwei Antworten zu vergleichen.
function fingerabdruck(daten) {
  const r = elfAus(daten);
  return r?.ids?.size ? [...r.ids].sort().join(",") : null;
}

export default async function AufstellungDiagnose({ searchParams }) {
  const { token, uid: meineUid } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) return <LigaFehlt titel="Aufstellung: kommen fremde Aufstellungen durch?" />;

  await verlangeLiga(leagueId, token);

  // Zwei verschiedene Gegner — nur so lässt sich der Vergleich anstellen.
  let manager = [];
  try {
    const rang = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
    manager = nurMitspieler(rang.us);
  } catch {
    // dann eben ohne
  }

  const fremde = manager.filter((m) => String(m.i) !== String(meineUid));
  const a = p.uid ? { i: p.uid, n: `#${p.uid}` } : fremde[0] ?? null;
  const b = fremde.find((m) => String(m.i) !== String(a?.i)) ?? null;

  // Die eigene Elf als Vergleichsgröße: Kommt sie bei einem Gegner
  // zurück, wertet der Endpunkt die uid nicht aus.
  let meine = null;
  try {
    meine = fingerabdruck(await kbFetch(`/v4/leagues/${leagueId}/lineup`, token));
  } catch {
    // egal
  }

  const ergebnisse = [];
  if (a) {
    for (const vorlage of KANDIDATEN(leagueId, a.i)) {
      const pfadA = vorlage;
      let daten = null;
      let fehler = null;
      try {
        daten = await kbFetch(pfadA, token);
      } catch (e) {
        fehler = e.message;
      }
      const fpA = daten ? fingerabdruck(daten) : null;

      let fpB = null;
      if (fpA && b) {
        try {
          fpB = fingerabdruck(await kbFetch(vorlage.replace(String(a.i), String(b.i)), token));
        } catch {
          // dann bleibt der Vergleich offen
        }
      }

      const baum = daten ? schluesselBaum(daten) : [];
      ergebnisse.push({
        pfad: vorlage.replace(String(a.i), "{uid}"),
        fehler,
        elf: fpA ? fpA.split(",").length : 0,
        eigene: fpA != null && fpA === meine,
        verschieden: fpA != null && fpB != null && fpA !== fpB,
        verglichen: fpA != null && fpB != null,
        // Auch wenn elfAus nichts herausholt: Steht in der Antwort
        // überhaupt etwas, das nach Aufstellung aussieht?
        verdaechtig: baum.filter((x) => x.verdaechtig).map((x) => x.pfad).slice(0, 6),
        daten,
      });
    }
  }

  const treffer = ergebnisse.find((r) => r.verschieden);

  // Der Kader des Gegners – vielleicht steckt die Aufstellung dort.
  let rohKader = null;
  try {
    if (a) rohKader = await kbFetch(`/v4/leagues/${leagueId}/managers/${a.i}/squad`, token);
  } catch {
    // egal
  }
  const liste = rohKader ? findeSpielerListe(rohKader) : [];
  const imKader = liste.length ? findeAufstellung(liste) : null;
  const analyse = liste.length ? felderAnalyse(liste) : [];

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Aufstellung: kommen fremde Aufstellungen durch?"
        unter={`Verglichen: ${a?.n ?? "–"} gegen ${b?.n ?? "–"} · eigene Elf ${meine ? "bekannt" : "unbekannt"}`}
        leagueId={leagueId}
      />

      <div className={`kb-hinweis ${treffer ? "kb-hinweis--gut" : "kb-hinweis--warn"}`}>
        {treffer
          ? `Gefunden: ${treffer.pfad} liefert für zwei Manager verschiedene Elfen.`
          : "Kein Kandidat liefert für zwei Manager Verschiedenes. Was antwortet, gibt immer dieselbe Elf zurück."}
      </div>

      <p className="kb-info">
        Ein Endpunkt, der <strong>antwortet</strong>, beweist nichts — er kann für jeden
        Manager dieselbe (eigene) Aufstellung liefern. Entscheidend ist die Spalte
        „verschieden“. Anderen Manager prüfen: <code>?league={leagueId}&uid=…</code> ·{" "}
        <Link href={`/liga?league=${leagueId}`}>zurück zur Liga</Link>
      </p>

      <section style={{ marginTop: 18 }}>
        <h2 className="kb-abschnitt-titel">1 · Die Kandidaten</h2>
        {ergebnisse.length === 0 ? (
          <p className="kb-info">Keine zwei Manager gefunden — ohne Gegner kein Vergleich.</p>
        ) : (
          <div className="kb-tabellenrahmen">
            <table className="kb-tabelle kb-tabelle--schmal">
              <thead>
                <tr>
                  <th className="kb-namensspalte">Pfad</th>
                  <th>Antwort</th>
                  <th>Elf</th>
                  <th>verschieden</th>
                  <th>verdächtige Felder</th>
                </tr>
              </thead>
              <tbody>
                {ergebnisse.map((r, i) => (
                  <tr key={r.pfad} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                    <td className="kb-namensspalte"><code>{r.pfad}</code></td>
                    <td className={r.fehler ? "kb-gedaempft" : "kb-plus"}>
                      {r.fehler ? r.fehler.slice(0, 24) : "OK"}
                    </td>
                    <td>
                      {r.elf > 0 ? r.elf : "–"}
                      {r.eigene && <span className="kb-leise"> = meine</span>}
                    </td>
                    <td className={r.verschieden ? "kb-plus" : "kb-gedaempft"}>
                      {!r.verglichen ? "–" : r.verschieden ? "ja" : "nein"}
                    </td>
                    <td className="kb-leise">
                      {r.verdaechtig?.length ? r.verdaechtig.join(", ").slice(0, 70) : "–"}
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
          2 · Steckt sie im Kader des Gegners?
          <span className="kb-leise"> {liste.length} Spieler</span>
        </h2>
        <p className="kb-info">
          {imKader
            ? `Ja: ${imKader.anzahl} Spieler über ${imKader.feld ?? "–"} (${imKader.art}).`
            : "Kein Feld im Kader zeichnet eine Aufstellung aus."}
        </p>
        {analyse.length > 0 && (
          <div className="kb-tabellenrahmen">
            <table className="kb-tabelle kb-tabelle--schmal">
              <thead>
                <tr>
                  <th className="kb-namensspalte">Feld</th>
                  <th>Werte</th>
                  <th>Beispiele</th>
                  <th>passt als</th>
                </tr>
              </thead>
              <tbody>
                {analyse.map((x, i) => (
                  <tr key={x.feld} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                    <td className="kb-namensspalte">
                      <code>{x.feld}</code>
                      {x.gesperrt && <span className="kb-leise"> gesperrt</span>}
                    </td>
                    <td>{x.verschieden}</td>
                    <td className="kb-leise">{x.beispiele.join(", ").slice(0, 50)}</td>
                    <td className={x.treffer.length ? "kb-plus" : "kb-gedaempft"}>
                      {x.treffer.length ? x.treffer.join(", ") : "–"}
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
          3 · Was der beste Kandidat roh liefert
        </h2>
        {(treffer ?? ergebnisse.find((r) => r.elf > 0))?.daten ? (
          <Rohdaten daten={(treffer ?? ergebnisse.find((r) => r.elf > 0)).daten} />
        ) : (
          <p className="kb-info">Kein Kandidat hat auswertbare Daten geliefert.</p>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 className="kb-abschnitt-titel">4 · Ein Spieler aus dem Kader, roh</h2>
        {liste[0] ? <Rohdaten daten={liste[0]} /> : <p className="kb-info">Kein Spieler vorhanden.</p>}
      </section>
    </main>
  );
}
