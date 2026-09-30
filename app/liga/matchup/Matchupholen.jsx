"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Ein Klick, dann läuft es durch — wie beim Startelf-Abruf.
//
// Ein Aufruf je Spieler passt nicht in einen Request, deshalb fasst der
// Browser selbst nach, bis nichts mehr offen ist. Abbrechen kostet nichts:
// Was geholt ist, steht in der Datenbank.
export default function Matchupholen({ leagueId, stand }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  // Als Ref: Die Schleife läuft in einem Abschluss über den Stand vom
  // Beginn des Laufs — ein useState-Wert bliebe darin für immer `false`.
  const abbruch = useRef(false);
  const [jetzt, setJetzt] = useState(stand);
  const [fehler, setFehler] = useState("");

  if (!jetzt.spielplan) {
    return (
      <p className="kb-legende">
        Noch kein Spielplan geladen — einmal „Alles aktualisieren&ldquo;, dann lassen
        sich hier die Punkte je Spiel holen.
      </p>
    );
  }

  const offen = jetzt.offen ?? 0;

  async function holen() {
    setLaeuft(true);
    abbruch.current = false;
    setFehler("");

    // Eine Schranke, keine Bedingung: Wird `offen` wider Erwarten nie
    // kleiner, hört der Lauf trotzdem auf.
    for (let runde = 0; runde < 20; runde++) {
      let daten;
      try {
        const res = await fetch(`/api/matchup?league=${leagueId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        daten = await res.json();
      } catch {
        setFehler("Verbindung unterbrochen — später noch einmal versuchen.");
        break;
      }

      if (daten.fehler) {
        setFehler(daten.gedrosselt
          ? "Kickbase drosselt gerade. Später noch einmal — das Geholte bleibt."
          : daten.fehler);
        break;
      }
      if (daten.stand) setJetzt(daten.stand);
      if ((daten.stand?.offen ?? 0) === 0) break;
      // Kein Fortschritt heißt: Es geht nicht weiter. Weiterzufassen
      // würde nur Aufrufe verbrennen.
      if (!daten.geholt) { setFehler("Der Lauf kommt nicht weiter — bitte melden."); break; }
      if (abbruch.current) break;
    }
    setLaeuft(false);
    // Die Tabelle rechnet der Server — neu laden, damit sie das Geholte zeigt.
    router.refresh();
  }

  return (
    <div className="kb-elfholen">
      <p className="kb-legende">
        {offen > 0
          ? <><strong>{offen}</strong> von {jetzt.gesamt} Spielern haben seit ihrer letzten Abfrage gespielt.</>
          : <>Alle Punkte bis zur letzten beendeten Partie sind da.</>}
      </p>

      {offen > 0 && (
        <button
          type="button"
          className={`kb-btn${laeuft ? "" : " kb-btn--haupt"}`}
          onClick={laeuft ? () => { abbruch.current = true; } : holen}
        >
          {laeuft ? `Läuft … (${offen} offen) — abbrechen` : `Punkte je Spiel holen (${offen} Spieler)`}
        </button>
      )}

      {fehler && <p className="kb-info kb-minus">{fehler}</p>}

      {offen > 0 && !laeuft && (
        <p className="kb-legende">
          Ein Kickbase-Aufruf je Spieler, gebremst auf 600 ms — nach einem vollen Spieltag
          rund fünf Minuten. Abbrechen ist gefahrlos, der nächste Klick macht weiter.
        </p>
      )}
    </div>
  );
}
