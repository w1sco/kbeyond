import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { DiagnoseKopf, LigaFehlt, probiere, Rohdaten } from "../_diagnose/Endpunkte";
import { LIVE_PFADE, findePunkte } from "@/lib/live";

export const dynamic = "force-dynamic";

// Wo stehen die Live-Punkte?
//
// Am Spieltag zeigt Kickbase laufende Punkte je Manager und je Spieler.
// Welcher Endpunkt sie liefert und unter welchem Feld, ist nicht belegt.
//
// Diese Seite rät nicht, sondern misst: Sie probiert die Kandidaten durch
// und sucht in **jeder** Antwort nach einer Liste, die die echten
// Manager-IDs dieser Liga trägt. Steht daneben eine plausible Punktzahl,
// ist der Fund benannt — mit Pfad, ID-Feld und Punktefeld.
//
// Aussagekräftig ist das nur **während** eines Spieltags. Vor dem Anpfiff
// stehen alle Live-Punkte auf 0 und sind von einer leeren Spalte nicht zu
// unterscheiden.
export default async function Livepunkte({ searchParams }) {
  const { token, uid: meineUid } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) return <LigaFehlt titel="Live-Punkte: wo stehen sie?" />;

  await verlangeLiga(leagueId, token);

  // Die echten Manager-IDs sind der Anker der ganzen Suche.
  let managerIds = [];
  let namen = new Map();
  try {
    const rang = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
    for (const m of rang.us ?? []) {
      const id = String(m?.i ?? "");
      if (id) { managerIds.push(id); namen.set(id, m?.n ?? id); }
    }
  } catch { /* dann eben ohne Anker – die Rohdaten stehen trotzdem da */ }

  const uid = p.uid ?? meineUid ?? managerIds[0] ?? null;

  const ergebnisse = await probiere(LIVE_PFADE(leagueId, uid), token);

  // Zusätzlich: Trägt der Kader je Spieler eine laufende Punktzahl? Der
  // Managerwert ist die Summe der Elf – die Einzelwerte braucht die Seite.
  const kader = uid
    ? await probiere([`/v4/leagues/${leagueId}/managers/${uid}/squad`], token)
    : [];

  // Jede Antwort gegen die echten IDs halten.
  const funde = ergebnisse
    .filter((r) => r.ok)
    .map((r) => ({ pfad: r.pfad, treffer: findePunkte(r.daten, managerIds) }))
    .filter((f) => f.treffer.length > 0);

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Live-Punkte: wo stehen sie?"
        unter={`${managerIds.length} Manager als Anker · ${ergebnisse.filter((r) => r.ok).length} von ${ergebnisse.length} Endpunkten antworten`}
        leagueId={leagueId}
      />

      <div className="kb-hinweis kb-hinweis--warn">
        Nur <strong>während</strong> eines Spieltags aussagekräftig. Vorher stehen alle
        Live-Punkte auf 0 und sind von einer leeren Spalte nicht zu unterscheiden.
      </div>

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">Gefunden</h2>
        {funde.length === 0 ? (
          <p className="kb-leise">
            In keiner Antwort steht eine Liste mit den Manager-IDs dieser Liga und einer
            Punktzahl daneben. Entweder läuft gerade kein Spieltag, oder der Endpunkt ist
            keiner der {ergebnisse.length} Kandidaten — dann helfen die Rohdaten unten weiter.
          </p>
        ) : (
          funde.map((f) => (
            <div key={f.pfad}>
              <h3 className="kb-pfad">{f.pfad}</h3>
              <div className="kb-tabellenrahmen"><table className="kb-tabelle">
                <thead>
                  <tr>
                    <th>Liste</th><th>ID-Feld</th><th>Punktefeld</th>
                    <th>Manager</th><th>versch. Werte</th>
                    <th>Probe</th>
                  </tr>
                </thead>
                <tbody>
                  {f.treffer.slice(0, 6).map((t, i) => (
                    <tr key={i}>
                      <td><code>{t.pfad}</code></td>
                      <td><code>{t.idFeld}</code></td>
                      <td><code>{t.punkteFeld}</code></td>
                      <td>{t.abdeckung}</td>
                      <td>{t.verschieden}</td>
                      <td className="kb-leise">
                        {[...t.treffer].slice(0, 3)
                          .map(([id, wert]) => `${namen.get(id) ?? id}: ${wert}`)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <p className="kb-leise">
                {f.spieler
                  ? `Einzelpunkte je Spieler: ${f.spieler.spieler.length} im Eintrag des ersten Managers, Feld ${f.spieler.punkteFeld} — Probe: ${f.spieler.spieler
                      .slice(0, 3)
                      .map((s) => `${s.id}: ${s.punkte}`)
                      .join(" · ")}`
                  : "Keine Spielerliste im Eintrag eines Managers — die Live-Seite kann für diesen Endpunkt nur Managersummen zeigen."}
              </p>
            </div>
          ))
        )}
      </section>

      {kader.length > 0 && kader[0].ok && (
        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">Kader eines Managers — Punkte je Spieler?</h2>
          <p className="kb-leise">
            Gesucht wird ein Feld, das sich am Spieltag ändert. <code>p</code> sind
            vermutlich Saisonpunkte, <code>ap</code> der Schnitt.
          </p>
          <Rohdaten daten={kader[0].daten} />
        </section>
      )}

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">Alle Antworten roh</h2>
        {ergebnisse.map((r) => (
          <div key={r.pfad}>
            <h3 className="kb-pfad">
              <span className={r.ok ? "kb-marke--exakt" : "kb-minus"}>{r.ok ? "OK" : r.fehler}</span>{" "}
              {r.pfad}
            </h3>
            {r.ok && <Rohdaten daten={r.daten} />}
          </div>
        ))}
      </section>

      <p className="kb-leise">
        <Link href={`/liga/live?league=${leagueId}`}>→ zur Live-Seite</Link>
      </p>
    </main>
  );
}
