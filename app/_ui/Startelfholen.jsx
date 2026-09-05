"use client";
import { useRef, useState } from "react";

// Ein Klick, dann läuft es durch.
//
// Ein Aufruf je Spieler passt nicht in einen Request — deshalb fasst der
// Browser selbst nach, bis nichts mehr offen ist, und zeigt dabei, wie
// weit er ist. Genau der Weg, den die News-Recherche schon geht.
//
// **Abbrechen kostet nichts.** Was geholt ist, steht in der Datenbank;
// der nächste Klick macht dort weiter, wo dieser aufgehört hat.
export default function Startelfholen({ leagueId, stand }) {
  const [laeuft, setLaeuft] = useState(false);
  // Als Ref, nicht als Zustand: Die Schleife läuft in einem Abschluss über
  // den Stand vom Beginn des Laufs — ein useState-Wert bliebe darin für
  // immer `false` und der Abbrechen-Knopf täte nichts.
  const abbruch = useRef(false);
  const [jetzt, setJetzt] = useState(stand ?? null);
  const [fehler, setFehler] = useState("");
  const [fertig, setFertig] = useState(false);

  // Ohne Spielplan gibt es keinen Spieltag, für den die Prognose gälte.
  if (!jetzt || jetzt.tag == null) {
    return (
      <p className="kb-legende">
        Noch kein Spielplan geladen — einmal „Alles aktualisieren&ldquo;, dann steht die
        Startelf-Chance hier zum Holen bereit.
      </p>
    );
  }

  const offen = jetzt.offen ?? 0;

  async function holen() {
    setLaeuft(true);
    abbruch.current = false;
    setFehler("");
    setFertig(false);

    // Eine Schranke, keine Bedingung: Sollte `offen` wider Erwarten nie
    // kleiner werden, hört der Lauf trotzdem auf, statt endlos zu ziehen.
    for (let runde = 0; runde < 20; runde++) {
      let daten;
      try {
        const res = await fetch(`/api/startelf?league=${leagueId}`, {
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
        setFehler(
          daten.gedrosselt
            ? "Kickbase drosselt gerade. Später noch einmal — das Geholte bleibt."
            : daten.fehler
        );
        break;
      }

      if (daten.stand) setJetzt(daten.stand);

      if ((daten.stand?.offen ?? 0) === 0) { setFertig(true); break; }

      // Kein Fortschritt heißt: Es geht nicht weiter. Weiterzufassen
      // würde nur Aufrufe verbrennen.
      if (!daten.geholt) {
        setFehler("Der Lauf kommt nicht weiter — bitte melden.");
        break;
      }

      if (abbruch.current) break;
    }
    setLaeuft(false);
  }

  return (
    <div className="kb-elfholen">
      <p className="kb-legende">
        Spieltag {jetzt.tag}: <strong>{jetzt.geprueft}</strong> von {jetzt.gesamt} Spielern
        abgefragt, davon {jetzt.mitAngabe} mit Angabe
        {offen > 0 && <> · <strong>{offen} offen</strong></>}
      </p>

      {offen > 0 && (
        <button
          type="button"
          className={`kb-btn${laeuft ? "" : " kb-btn--haupt"}`}
          onClick={laeuft ? () => { abbruch.current = true; } : holen}
        >
          {laeuft ? `Läuft … (${offen} offen) — abbrechen` : `Startelf holen (${offen} Spieler)`}
        </button>
      )}

      {fertig && <p className="kb-info">Alle Spieler abgefragt.</p>}
      {fehler && <p className="kb-info kb-minus">{fehler}</p>}

      {offen > 0 && !laeuft && (
        <p className="kb-legende">
          Läuft in einem Rutsch durch und dauert ein paar Minuten. Abbrechen ist
          gefahrlos — das Geholte bleibt, der nächste Klick macht weiter.
        </p>
      )}
    </div>
  );
}
