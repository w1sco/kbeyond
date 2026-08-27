"use client";
import { useMemo, useState } from "react";
import { euroKurz, vorZeit, position } from "@/lib/format";

// Derselbe Speicher wie bei "Frag die Liga" – wer dort schon einen
// Schlüssel hinterlegt hat, muss ihn hier nicht noch einmal eintragen.
const SPEICHER = "kb-llm";
// Zwölf Spieler je Sammelaufruf: Gesucht wird auf Übersichtsseiten, die
// viele Spieler auf einmal abdecken. 71 Einzelrecherchen wären ein
// Vielfaches an Kosten — und liefen in Vercels Zeitgrenze (504).
const BUENDEL = 12;

// Länger als das darf eine einzelne Anfrage nicht brauchen. Ohne eigene
// Grenze hinge der Lauf an einer hängenden Anfrage fest.
const GEDULD_MS = 90_000;
const FRISCH_MS = 12 * 3600 * 1000;

function ladeEinstellung() {
  try {
    return JSON.parse(localStorage.getItem(SPEICHER)) ?? {};
  } catch {
    return {};
  }
}

const FARBE = { gut: "kb-plus", schlecht: "kb-minus" };

// Die Position kommt aus zwei Quellen in zwei Formen: der gespeicherte
// Kader trägt sie schon als Kürzel ("ABW"), der Live-Markt als Zahl.
// position() kennt nur die Zahl – ein Kürzel ergäbe dort "–".
function posText(p) {
  if (p == null || p === "") return "";
  return Number.isFinite(Number(p)) ? position(Number(p)) : String(p);
}

export default function Newsliste({ leagueId, gruppen }) {
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState(null);
  const [fehler, setFehler] = useState("");
  const [nurNeues, setNurNeues] = useState(false);

  const alle = useMemo(() => gruppen.flatMap((g) => g.spieler), [gruppen]);
  // Einträge, die als "recherchiert" gelten, aber nichts enthalten.
  const leere = useMemo(() => alle.filter((s) => s.meldung && !s.meldung.text).length, [alle]);

  // Wer braucht überhaupt eine Recherche? Frisch Geholtes nicht noch einmal.
  const offen = useMemo(
    () =>
      alle.filter((s) => {
        const stand = s.meldung?.stand;
        return !stand || Date.now() - new Date(stand).getTime() > FRISCH_MS;
      }),
    [alle]
  );

  async function laden(liste, modus = "sammeln") {
    const { anbieter, schluessel, modell } = ladeEinstellung();
    if (anbieter && anbieter !== "claude") {
      setFehler(
        "Die Recherche läuft nur über Claude — nur dort ist die Websuche eingebaut. " +
          "Trage unter „Frag die Liga“ einen Anthropic-Schlüssel ein."
      );
      return;
    }
    if (!schluessel) {
      setFehler("Kein API-Schlüssel hinterlegt. Trage ihn unter „Frag die Liga“ auf der Ligaseite ein.");
      return;
    }

    setFehler("");
    setLaeuft(true);
    let fertig = 0;
    let mitMeldung = 0;
    let ohneAntwort = 0;
    let letzteDiagnose = null;
    const gescheitert = [];
    let letzterGrund = "";

    const schritt = modus === "einzeln" ? 1 : BUENDEL;
    for (let i = 0; i < liste.length; i += schritt) {
      const teil = liste.slice(i, i + schritt);
      setFortschritt({
        fertig,
        gesamt: liste.length,
        namen: teil.length > 3 ? [`${teil.length} Spieler`] : teil.map((s) => s.name),
        gescheitert: gescheitert.length,
        treffer: mitMeldung,
      });

      // Ein einzelner Ausfall beendet den Lauf nicht mehr. Vorher riss eine
      // Zeitüberschreitung bei Spieler 1 alle übrigen 70 mit, obwohl jeder
      // für sich funktioniert hätte.
      try {
        const abbruch = new AbortController();
        const wecker = setTimeout(() => abbruch.abort(), GEDULD_MS);
        let res;
        try {
          res = await fetch(`/api/news?league=${leagueId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abbruch.signal,
            body: JSON.stringify({
              schluessel,
              modell,
              modus,
            spieler: teil.map((s) => ({ id: s.id, name: s.name, verein: s.verein })),
            }),
          });
        } finally {
          clearTimeout(wecker);
        }

        // Bei einer Zeitüberschreitung antwortet nicht die Route, sondern
        // das Netz davor — mit einer HTML-Seite, nicht mit JSON.
        const daten = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            daten?.fehler ??
              (res.status === 504
                ? "Zeitüberschreitung — die Recherche hat zu lange gebraucht"
                : `Fehler ${res.status}`)
          );
        }
        // Was das Modell wirklich geliefert hat, statt es zu erraten.
        fertig += daten?.gespeichert ?? teil.length;
        mitMeldung += daten?.mitMeldung ?? 0;
        ohneAntwort += Math.max(0, teil.length - (daten?.gespeichert ?? teil.length));
        if (daten?.diagnose) letzteDiagnose = daten.diagnose;
      } catch (e) {
        gescheitert.push(teil[0]?.name ?? "?");
        letzterGrund = e?.name === "AbortError" ? "Zeitüberschreitung" : e?.message ?? "Fehler";

        // Schlägt gleich der Anfang mehrfach fehl, stimmt etwas
        // Grundsätzliches — dann nicht 70-mal weiter Geld ausgeben.
        if (gescheitert.length >= 3 && fertig === 0) {
          setFehler(`Abgebrochen: die ersten ${gescheitert.length} Versuche schlugen fehl (${letzterGrund}).`);
          setLaeuft(false);
          setFortschritt(null);
          return;
        }
      }
    }

    if (gescheitert.length > 0) {
      setFehler(
        `${fertig} von ${liste.length} geholt. Nicht geklappt hat es bei: ` +
          `${gescheitert.slice(0, 8).join(", ")}${gescheitert.length > 8 ? " …" : ""} (${letzterGrund}). ` +
          "Nochmal klicken holt nur die fehlenden."
      );
    } else if (mitMeldung === 0 && fertig > 0) {
      // Null Meldungen bei einem ganzen Kader ist meist kein Ergebnis,
      // sondern ein Ausfall. Die Zahlen sagen, welcher.
      const d = letzteDiagnose;
      setFehler(
        `Durchgelaufen, aber keine einzige Meldung gefunden. ` +
          (d
            ? `Zuletzt: ${d.suchen} Websuchen${d.suchfehler ? ` (davon ${d.suchfehler} fehlgeschlagen)` : ""}, ` +
              `${d.eintraege} Antworten des Modells, ${d.verworfen} davon nicht zuordenbar.` +
              (d.suchen === 0 ? " Die Websuche lief offenbar gar nicht." : "")
            : "") +
          (ohneAntwort > 0 ? ` ${ohneAntwort} Spieler blieben ohne Antwort und wurden nicht gespeichert.` : "")
      );
    }

    // Die Seite liest aus der Datenbank – neu laden zeigt das Ergebnis.
    if (fertig > 0 && gescheitert.length === 0) window.location.reload();
    else {
      setLaeuft(false);
      setFortschritt(null);
      if (fertig > 0) setTimeout(() => window.location.reload(), 4000);
    }
  }

  return (
    <>
      <div className="kb-newsleiste">
        <button
          className="kb-btn kb-btn--stark"
          disabled={laeuft || offen.length === 0}
          onClick={() => laden(offen)}
        >
          {laeuft
            ? "Recherche läuft …"
            : offen.length === 0
              ? "Alles aktuell"
              : `${offen.length} Spieler recherchieren`}
        </button>

        <button className="kb-btn" disabled={laeuft || alle.length === 0} onClick={() => laden(alle)}>
          Alle {alle.length} neu holen
        </button>

        {leere > 0 && (
          <button
            className="kb-btn"
            disabled={laeuft}
            onClick={async () => {
              await fetch(`/api/news?league=${leagueId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ aktion: "leeren" }),
              });
              window.location.reload();
            }}
            title="Einträge ohne Meldung löschen, damit sie wieder abgefragt werden"
          >
            {leere} leere verwerfen
          </button>
        )}

        <span className="kb-leise">
          {(() => {
            const n = Math.ceil(offen.length / BUENDEL);
            return n === 0
              ? "nichts offen"
              : `Sammellauf: ${n} ${n === 1 ? "Anfrage" : "Anfragen"} über Übersichtsseiten`;
          })()}
        </span>

        <label className="kb-ankreuz" style={{ marginBottom: 0 }}>
          <input type="checkbox" checked={nurNeues} onChange={(e) => setNurNeues(e.target.checked)} />
          <span>nur Spieler mit Meldung</span>
        </label>
      </div>

      {fortschritt && (
        <div className="kb-hinweis kb-hinweis--info">
          {fortschritt.fertig} von {fortschritt.gesamt} recherchiert{fortschritt.treffer > 0 ? ` · ${fortschritt.treffer} mit Meldung` : ""}
          {fortschritt.namen.length > 0 && ` · gerade: ${fortschritt.namen.join(", ")}`}
        </div>
      )}
      {fehler && <div className="kb-hinweis kb-hinweis--fehler">{fehler}</div>}

      {gruppen.map((g) => {
        const zeilen = nurNeues ? g.spieler.filter((s) => s.meldung?.text) : g.spieler;
        return (
          <section key={g.schluessel} className="kb-karte">
            <h2 className="kb-abschnitt-titel">
              {g.titel}
              <span className="kb-leise"> {zeilen.length} Spieler</span>
            </h2>

            {zeilen.length === 0 ? (
              <p className="kb-info">
                {g.spieler.length === 0
                  ? "Keine Spieler in dieser Gruppe."
                  : "Zu keinem dieser Spieler gibt es eine Meldung."}
              </p>
            ) : (
              <ul className="kb-newsliste">
                {zeilen.map((s) => (
                  <li key={s.id} className="kb-newszeile">
                    <div className="kb-newskopf">
                      <strong>{s.name}</strong>
                      <span className="kb-leise">
                        {posText(s.position) ? ` ${posText(s.position)}` : ""}
                        {s.marktwert > 0 ? ` · ${euroKurz(s.marktwert)}` : ""}
                      </span>
                      {/* Die Tiefensuche kostet deutlich mehr als ein Platz
                          im Sammellauf – deshalb nur auf ausdrücklichen Klick
                          und immer für genau einen Spieler. */}
                      <button
                        className="kb-btn kb-btn--klein"
                        disabled={laeuft}
                        onClick={() => laden([s], "einzeln")}
                        title="Gründlich nachsehen: mehr Suchen, auch regionale Quellen"
                      >
                        genauer
                      </button>
                    </div>

                    {s.meldung?.text ? (
                      <>
                        <p className={`kb-newstext ${FARBE[s.meldung.stimmung] ?? ""}`}>
                          {s.meldung.text}
                        </p>
                        <div className="kb-newsfuss">
                          {(s.meldung.quellen ?? []).map((q, i) => (
                            <span key={i}>
                              {q.url ? (
                                <a href={q.url} target="_blank" rel="noopener noreferrer">
                                  {q.name || q.url}
                                </a>
                              ) : (
                                q.name
                              )}
                            </span>
                          ))}
                          <span className="kb-leise">{vorZeit(s.meldung.stand)}</span>
                        </div>
                      </>
                    ) : (
                      <p className="kb-newstext kb-gedaempft">
                        {s.meldung
                          ? "Nichts Neues in den letzten 30 Tagen."
                          : "Noch nicht recherchiert."}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
