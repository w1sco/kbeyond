import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { initSchema, getKader } from "@/lib/db";
import { DiagnoseKopf, LigaFehlt, probiere, Rohdaten } from "../_diagnose/Endpunkte";
import { STUFEN, stufe, leseChance } from "@/lib/startelf";

export const dynamic = "force-dynamic";

// Zwei Fragen zur Startelf-Chance, die beide **nicht belegt** sind:
//
// 1. **Wie herum geht die Skala?** `prob` ist eine Zahl; dass 1 „sicher"
//    und 5 „spielt nicht" heißt, stützt sich auf eine einzige Beobachtung
//    (Jonathan Tah, `prob: 2`). Umgekehrt gelesen stünde vor einem
//    Stammspieler ein rotes Ausrufezeichen — und danach stellt jemand auf.
//    Diese Seite legt die eigenen Spieler daneben: Wer bei dir sicher
//    spielt, muss hier ★ oder ✔ tragen.
//
// 2. **Geht es billiger als ein Aufruf je Spieler?** Belegt ist das Feld
//    nur im Spielerprofil — 470 Aufrufe je Spieltag. Trägt eine der
//    Listen, die wir ohnehin holen (Markt, Kader, Vereinskader,
//    Teamcenter), dasselbe Feld, wäre es umsonst zu haben.
const WIE_VIELE = 12;

// Trägt diese Antwort irgendwo ein `prob`? Gesucht wird in jeder Liste von
// Objekten, egal wie tief sie hängt — nicht am Feldnamen der Liste.
function sucheProb(daten, tiefe = 0) {
  if (!daten || typeof daten !== "object" || tiefe > 5) return null;
  if (Array.isArray(daten)) {
    const mit = daten.filter((x) => x && typeof x === "object" && x.prob !== undefined);
    if (mit.length > 0) {
      return { anzahl: mit.length, von: daten.length, werte: [...new Set(mit.map((x) => x.prob))].slice(0, 6) };
    }
    for (const x of daten) {
      const t = sucheProb(x, tiefe + 1);
      if (t) return t;
    }
    return null;
  }
  for (const wert of Object.values(daten)) {
    const t = sucheProb(wert, tiefe + 1);
    if (t) return t;
  }
  return null;
}

export default async function StartelfDiagnose({ searchParams }) {
  const { token, uid } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) return <LigaFehlt titel="Startelf-Chance" />;

  await verlangeLiga(leagueId, token);

  if (p.suchen !== "1") {
    return (
      <main className="kb-seite kb-seite--schmal">
        <DiagnoseKopf titel="Startelf-Chance" leagueId={leagueId} />
        <section className="kb-karte">
          <p>
            Kickbase liefert im Spielerprofil ein Feld <code>prob</code> — die
            Einschätzung von Ligainsider, ob jemand am kommenden Spieltag in der
            Startelf steht. Zwei Dinge sind daran <strong>nicht belegt</strong>:
          </p>
          <ol>
            <li>
              Wie herum die Skala geht. Angenommen wird <strong>1 = sicher</strong> bis
              <strong> 5 = spielt nicht</strong>, gestützt auf eine einzige Beobachtung.
            </li>
            <li>
              Ob eine der Listen, die wir ohnehin holen, dasselbe Feld trägt — dann
              wären die 470 Einzelaufrufe je Spieltag nicht nötig.
            </li>
          </ol>
          <p className="kb-leise">
            Rund <strong>{WIE_VIELE + 4} Kickbase-Aufrufe</strong>. Läuft deshalb erst
            auf Klick.
          </p>
          <p>
            <Link href={`/startelf?league=${leagueId}&suchen=1`} className="kb-btn kb-btn--haupt">
              Nachsehen
            </Link>
          </p>
        </section>
      </main>
    );
  }

  await initSchema();

  // ── 1. Die eigenen Spieler, die man selbst beurteilen kann ────────
  const kader = await getKader(leagueId);
  const meine = (kader.proManager.get(String(uid)) ?? []).slice(0, WIE_VIELE);

  const zeilen = [];
  for (const s of meine) {
    try {
      const roh = await kbFetch(`/v4/competitions/1/players/${s.id}`, token);
      zeilen.push({
        id: String(s.id),
        name: s.name,
        roh: roh?.prob ?? null,
        quelle: roh?.plpt ?? null,
        chance: leseChance(roh),
      });
    } catch (e) {
      zeilen.push({ id: String(s.id), name: s.name, fehler: e.message });
    }
  }

  // ── 2. Trägt eine der billigen Listen dasselbe Feld? ──────────────
  const tid = meine.find((s) => s.team_id)?.team_id ?? "2";
  const billig = await probiere([
    `/v4/leagues/${leagueId}/market`,
    `/v4/leagues/${leagueId}/managers/${uid}/squad`,
    `/v4/competitions/1/teams/${tid}/teamprofile`,
    `/v4/competitions/1/teams/${tid}/teamcenter`,
  ], token);

  const befund = billig.map((r) => ({ ...r, prob: r.ok ? sucheProb(r.daten) : null }));
  const treffer = befund.filter((b) => b.prob);

  return (
    <main className="kb-seite kb-seite--schmal">
      <DiagnoseKopf
        titel="Startelf-Chance"
        unter="Stimmt die Zuordnung — und geht es billiger?"
        leagueId={leagueId}
      />

      <section className="kb-karte">
        <h2 className="kb-abschnitt">1. Stimmt die Zuordnung?</h2>
        <p>
          Vergleich das mit deiner Kickbase-App. <strong>Wer dort einen blauen Stern
          trägt, muss hier ★ tragen.</strong> Steht es umgekehrt — Stammspieler mit ✕,
          Bankdrücker mit ★ —, ist die Skala andersherum und muss in{" "}
          <code>lib/startelf.js</code> gedreht werden.
        </p>

        {zeilen.length === 0 ? (
          <p className="kb-info">
            Kein eigener Kader gespeichert. Einmal „Alles aktualisieren&ldquo; auf der
            Ligaseite, dann noch einmal hier.
          </p>
        ) : (
          <div className="kb-tabellenrahmen">
            <table className="kb-tabelle kb-tabelle--schmal">
              <thead>
                <tr>
                  <th className="kb-namensspalte">Spieler</th>
                  <th><code>prob</code></th>
                  <th>gelesen als</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z, i) => {
                  const s = stufe(z.chance);
                  return (
                    <tr key={z.id} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                      <td className="kb-namensspalte">{z.name}</td>
                      <td>
                        {z.fehler
                          ? <span className="kb-minus">{z.fehler}</span>
                          : z.roh == null
                            ? <span className="kb-gedaempft">kein Feld</span>
                            : <strong>{String(z.roh)}</strong>}
                      </td>
                      <td>
                        {s
                          ? <span className={s.klasse}><strong>{s.zeichen}</strong> {s.name}</span>
                          : <span className="kb-gedaempft">keine Angabe</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="kb-legende">
          Angenommene Skala:{" "}
          {STUFEN.map((s) => (
            <span key={s.wert} className={s.klasse} style={{ marginRight: 10 }}>
              {s.wert} = <strong>{s.zeichen}</strong> {s.kurz}
            </span>
          ))}
        </p>
        {zeilen.some((z) => z.quelle) && (
          <p className="kb-legende">
            Quelle laut Kickbase: <strong>{zeilen.find((z) => z.quelle)?.quelle}</strong>
          </p>
        )}
      </section>

      <section className="kb-karte">
        <h2 className="kb-abschnitt">2. Geht es billiger?</h2>
        <p>
          Belegt ist <code>prob</code> nur im Spielerprofil — <strong>ein Aufruf je
          Spieler</strong>, bei rund 470 Spielern der teuerste Posten im Projekt, und
          jede Woche neu. Trägt eine dieser Listen dasselbe Feld, wäre es umsonst.
        </p>

        <div className={`kb-hinweis ${treffer.length ? "kb-hinweis--gut" : ""}`}>
          {treffer.length
            ? `${treffer.length} von ${befund.length} Listen tragen prob — das spart die Einzelaufrufe.`
            : `Keine der ${befund.length} Listen trägt prob. Es bleibt beim Aufruf je Spieler.`}
        </div>

        <div className="kb-tabellenrahmen">
          <table className="kb-tabelle kb-tabelle--schmal">
            <thead>
              <tr>
                <th className="kb-namensspalte">Endpunkt</th>
                <th>Antwort</th>
                <th><code>prob</code> gefunden</th>
              </tr>
            </thead>
            <tbody>
              {befund.map((b, i) => (
                <tr key={b.pfad} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                  <td className="kb-namensspalte"><code>{b.pfad}</code></td>
                  <td>{b.ok ? "OK" : <span className="kb-minus">{b.fehler}</span>}</td>
                  <td>
                    {b.prob
                      ? <span className="kb-plus">
                          <strong>ja</strong> — {b.prob.anzahl} von {b.prob.von} Einträgen,
                          Werte {b.prob.werte.join(", ")}
                        </span>
                      : b.ok ? <span className="kb-gedaempft">nein</span> : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="kb-karte">
        <summary>Rohdaten der vier Listen</summary>
        <Rohdaten daten={befund.map((b) => ({ pfad: b.pfad, ok: b.ok, prob: b.prob }))} />
      </details>
    </main>
  );
}
