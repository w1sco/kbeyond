"use client";
import { useMemo, useState } from "react";
import { euroKurz, vorZeit, position } from "@/lib/format";

// Derselbe Speicher wie bei "Frag die Liga" – wer dort schon einen
// Schlüssel hinterlegt hat, muss ihn hier nicht noch einmal eintragen.
const SPEICHER = "kb-llm";
const BUENDEL = 5;
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

  // Wer braucht überhaupt eine Recherche? Frisch Geholtes nicht noch einmal.
  const offen = useMemo(
    () =>
      alle.filter((s) => {
        const stand = s.meldung?.stand;
        return !stand || Date.now() - new Date(stand).getTime() > FRISCH_MS;
      }),
    [alle]
  );

  async function laden(liste) {
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

    try {
      for (let i = 0; i < liste.length; i += BUENDEL) {
        const teil = liste.slice(i, i + BUENDEL);
        setFortschritt({ fertig, gesamt: liste.length, namen: teil.map((s) => s.name) });

        const res = await fetch(`/api/news?league=${leagueId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schluessel,
            modell,
            spieler: teil.map((s) => ({ id: s.id, name: s.name, verein: s.verein })),
          }),
        });

        const daten = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(daten.fehler ?? `Fehler ${res.status}`);

        fertig += teil.length;
        setFortschritt({ fertig, gesamt: liste.length, namen: [] });
      }

      // Die Seite liest aus der Datenbank – neu laden zeigt das Ergebnis.
      window.location.reload();
    } catch (e) {
      setFehler(
        `${e.message}${fertig > 0 ? ` — ${fertig} Spieler waren schon fertig und sind gespeichert.` : ""}`
      );
      setLaeuft(false);
      setFortschritt(null);
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

        <label className="kb-ankreuz" style={{ marginBottom: 0 }}>
          <input type="checkbox" checked={nurNeues} onChange={(e) => setNurNeues(e.target.checked)} />
          <span>nur Spieler mit Meldung</span>
        </label>
      </div>

      {fortschritt && (
        <div className="kb-hinweis kb-hinweis--info">
          {fortschritt.fertig} von {fortschritt.gesamt} recherchiert
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
