"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Ein Klick, dann läuft es durch — wie beim Startelf-Abruf.
//
// Ein Aufruf je Spieler passt nicht in einen Request, deshalb fasst der
// Browser selbst nach, bis nichts mehr offen ist. Jede Antwort kommt als
// Strom mit einer Zeile je Spieler — so zählt die Anzeige live mit, statt
// 45 Sekunden stillzustehen.
//
// **Abbrechen wirkt sofort:** Der laufende Request wird abgebrochen, der
// Server merkt es am Signal und schreibt, was er bis dahin hat.
export default function Matchupholen({ leagueId, stand }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  // Als Ref: Die Schleife läuft in einem Abschluss über den Stand vom
  // Beginn des Laufs — ein useState-Wert bliebe darin für immer gleich.
  const steuerung = useRef(null);
  // Der Stand aus dem letzten Lauf; ohne Lauf gilt, was der Server liefert.
  // Nach einem Abbruch wird er verworfen — sonst stünde der alte Zähler da,
  // obwohl die geholten Spieler längst in der Datenbank sind.
  const [ausLauf, setAusLauf] = useState(null);
  const jetzt = ausLauf ?? stand;
  const [live, setLive] = useState(null); // { geholt, gesamt }
  const [fehler, setFehler] = useState("");

  if (!jetzt.spielplan) {
    return (
      <p className="kb-legende">
        Noch kein Spielplan geladen — einmal „Alles aktualisieren&ldquo;, dann lassen
        sich hier die Punkte je Spiel holen.
      </p>
    );
  }

  const zuFragen = jetzt.zuFragen ?? jetzt.offen ?? 0;
  const ohneNeue = jetzt.ohneNeuePunkte ?? 0;
  const offen = jetzt.offen ?? 0;

  // Eine Runde: den Strom lesen, bis die Schlusszeile kommt.
  async function runde(signal, bisher) {
    const res = await fetch(`/api/matchup?league=${leagueId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    });
    if (!res.body) return res.json();

    const leser = res.body.getReader();
    const dekodierer = new TextDecoder();
    let rest = "";
    let schluss = null;
    for (;;) {
      const { value, done } = await leser.read();
      if (done) break;
      rest += dekodierer.decode(value, { stream: true });
      const zeilen = rest.split("\n");
      rest = zeilen.pop();
      for (const z of zeilen) {
        if (!z.trim()) continue;
        const d = JSON.parse(z);
        if (d.fortschritt) {
          setLive({ geholt: bisher + d.fortschritt.geholt, gesamt: bisher + d.fortschritt.zuFragen });
        }
        if (d.ende) schluss = d;
      }
    }
    return schluss ?? { fehler: "Die Antwort brach ab — später noch einmal versuchen." };
  }

  async function holen() {
    setLaeuft(true);
    setFehler("");
    const ctrl = new AbortController();
    steuerung.current = ctrl;
    let bisher = 0;

    // Eine Schranke, keine Bedingung: Wird `offen` wider Erwarten nie
    // kleiner, hört der Lauf trotzdem auf.
    for (let r = 0; r < 20; r++) {
      let daten;
      try {
        daten = await runde(ctrl.signal, bisher);
      } catch {
        if (!ctrl.signal.aborted) setFehler("Verbindung unterbrochen — später noch einmal versuchen.");
        break;
      }

      if (daten.fehler) {
        setFehler(daten.gedrosselt
          ? "Kickbase drosselt gerade. Später noch einmal — das Geholte bleibt."
          : daten.fehler);
        break;
      }
      if (daten.stand) setAusLauf(daten.stand);
      bisher += daten.geholt ?? 0;
      if ((daten.stand?.offen ?? 0) === 0) break;
      // Kein Fortschritt heißt: Es geht nicht weiter. Weiterzufassen
      // würde nur Aufrufe verbrennen.
      if (!daten.geholt && !daten.uebersprungen) {
        setFehler("Der Lauf kommt nicht weiter — bitte melden.");
        break;
      }
      if (ctrl.signal.aborted) break;
    }
    const abgebrochen = ctrl.signal.aborted;
    steuerung.current = null;
    if (abgebrochen) {
      // Der Server schreibt den Spieler, bei dem er gerade war, noch fertig.
      await new Promise((r) => setTimeout(r, 1200));
      setAusLauf(null);
    }
    setLaeuft(false);
    setLive(null);
    // Die Tabelle rechnet der Server — neu laden, damit sie das Geholte zeigt.
    router.refresh();
  }

  return (
    <div className="kb-elfholen">
      <p className="kb-legende">
        {offen === 0 ? (
          <>Alle Punkte bis zur letzten beendeten Partie sind da.</>
        ) : (
          <>
            <strong>{zuFragen}</strong> Spieler zu fragen
            {ohneNeue > 0 && <> · {ohneNeue} ohne neue Punkte, die ohne Aufruf abgehakt werden</>}
          </>
        )}
      </p>

      {offen > 0 && (
        <button
          type="button"
          className={`kb-btn${laeuft ? "" : " kb-btn--haupt"}`}
          onClick={laeuft ? () => steuerung.current?.abort() : holen}
        >
          {laeuft
            ? `Läuft … ${live ? `${live.geholt} von ${live.gesamt}` : "startet"} — abbrechen`
            : zuFragen > 0 ? `Punkte je Spiel holen (${zuFragen} Spieler)` : "Abhaken (ohne Aufruf)"}
        </button>
      )}

      {fehler && <p className="kb-info kb-minus">{fehler}</p>}

      {offen > 0 && !laeuft && jetzt.listeVeraltet && (
        <p className="kb-legende">
          Die Spielerliste ist älter als das letzte Spiel. Erst „Alles aktualisieren&ldquo;,
          dann lassen sich Spieler ohne neue Punkte überspringen — das spart Aufrufe.
        </p>
      )}
      {zuFragen > 0 && !laeuft && (
        <p className="kb-legende">
          Ein Kickbase-Aufruf je Spieler, gebremst auf 600 ms — rund {Math.max(1, Math.round(zuFragen * 0.7 / 60))}{" "}
          Minute{Math.round(zuFragen * 0.7 / 60) > 1 ? "n" : ""}. Abbrechen ist gefahrlos, der
          nächste Klick macht weiter.
        </p>
      )}
    </div>
  );
}
