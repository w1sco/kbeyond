"use client";
import { useState, useEffect, useRef } from "react";
import Hinweis from "../_ui/Hinweis";

const ANBIETER = {
  claude:  { name: "Claude",  hilfe: "console.anthropic.com → API Keys",   url: "https://console.anthropic.com/settings/keys" },
  chatgpt: { name: "ChatGPT", hilfe: "platform.openai.com → API keys",     url: "https://platform.openai.com/api-keys" },
  gemini:  { name: "Gemini",  hilfe: "aistudio.google.com → Get API key",  url: "https://aistudio.google.com/apikey" },
};

const BEISPIELE = [
  "Wen muss ich verkaufen, um aus dem Minus zu kommen?",
  "Wer kann sich den teuersten freien Spieler leisten?",
  "Welcher Manager hat am meisten Spielraum für ein Gebot?",
];

// Der Schlüssel bleibt im Browser. Er wird bei jeder Frage mitgeschickt,
// einmal benutzt und nirgends gespeichert — weder in der Datenbank noch im
// Protokoll. Damit zahlt jeder seine eigenen Anfragen.
const SPEICHER = "kb-llm";

function ladeEinstellung() {
  try {
    return JSON.parse(localStorage.getItem(SPEICHER)) ?? {};
  } catch {
    return {};
  }
}

export default function Frag({ leagueId }) {
  const [anbieter, setAnbieter] = useState("claude");
  const [schluessel, setSchluessel] = useState("");
  const [modell, setModell] = useState("");
  const [modelle, setModelle] = useState([]);
  const [offen, setOffen] = useState(false);
  const [pruefe, setPruefe] = useState(false);

  const [frage, setFrage] = useState("");
  const [antwort, setAntwort] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState("");
  const abbruch = useRef(null);

  useEffect(() => {
    const e = ladeEinstellung();
    if (e.anbieter) setAnbieter(e.anbieter);
    if (e.schluessel) setSchluessel(e.schluessel);
    if (e.modell) setModell(e.modell);
    if (e.modelle) setModelle(e.modelle);
    if (!e.schluessel) setOffen(true);
  }, []);

  function sichern(neu) {
    const stand = { anbieter, schluessel, modell, modelle, ...neu };
    try {
      localStorage.setItem(SPEICHER, JSON.stringify(stand));
    } catch {
      // Privater Modus o. ä. – dann gilt die Eingabe nur für diese Sitzung
    }
  }

  async function modelleLaden() {
    if (!schluessel.trim()) return;
    setPruefe(true);
    setFehler("");
    try {
      const res = await fetch(`/api/modelle?league=${leagueId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anbieter, schluessel: schluessel.trim() }),
      });
      const daten = await res.json();
      if (!res.ok) {
        setFehler(daten.error ?? `Fehler ${res.status}`);
        return;
      }
      const gewaehlt = daten.modelle.some((m) => m.id === daten.standard)
        ? daten.standard
        : daten.modelle[0].id;
      setModelle(daten.modelle);
      setModell(gewaehlt);
      sichern({ modelle: daten.modelle, modell: gewaehlt, schluessel: schluessel.trim() });
      setOffen(false);
    } catch (e) {
      setFehler(e.message);
    } finally {
      setPruefe(false);
    }
  }

  function anbieterWechseln(neu) {
    setAnbieter(neu);
    setModelle([]);
    setModell("");
    setSchluessel("");
    sichern({ anbieter: neu, modelle: [], modell: "", schluessel: "" });
  }

  function vergessen() {
    setSchluessel("");
    setModelle([]);
    setModell("");
    setAntwort("");
    try {
      localStorage.removeItem(SPEICHER);
    } catch {
      // egal
    }
    setOffen(true);
  }

  async function fragen(text) {
    const inhalt = (text ?? frage).trim();
    if (!inhalt || laeuft) return;
    if (!schluessel.trim() || !modell) {
      setOffen(true);
      setFehler("Erst Anbieter und Schlüssel eintragen.");
      return;
    }

    setLaeuft(true);
    setFehler("");
    setAntwort("");
    abbruch.current = new AbortController();

    try {
      const res = await fetch(`/api/frag?league=${leagueId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frage: inhalt, anbieter, schluessel: schluessel.trim(), modell }),
        signal: abbruch.current.signal,
      });

      if (!res.ok) {
        const daten = await res.json().catch(() => ({}));
        setFehler(daten.error ?? `Fehler ${res.status}`);
        return;
      }

      const leser = res.body.getReader();
      const dekoder = new TextDecoder();
      for (;;) {
        const { done, value } = await leser.read();
        if (done) break;
        setAntwort((alt) => alt + dekoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if (e.name !== "AbortError") setFehler(e.message);
    } finally {
      setLaeuft(false);
      abbruch.current = null;
    }
  }

  const bereit = Boolean(schluessel.trim() && modell);

  return (
    <section className="kb-karte kb-frag">
      <h2 className="kb-abschnitt-titel">
        Frag die Liga
        {bereit && (
          <span className="kb-leise">
            {" "}{ANBIETER[anbieter].name} · {modell}
            {" "}<button className="kb-textknopf" onClick={() => setOffen(!offen)}>ändern</button>
          </span>
        )}
      </h2>

      <p className="kb-info">
        Fragen zum gespeicherten Datensatz — Kontostände, Kader, freie Spieler. Gerechnet
        wird mit den Zahlen dieser Seite.
      </p>

      {offen && (
        <div className="kb-zugang">
          <div className="kb-sortleiste kb-sortleiste--immer">
            {Object.entries(ANBIETER).map(([id, a]) => (
              <button
                key={id}
                className={`kb-sortchip${anbieter === id ? " kb-sortchip--aktiv" : ""}`}
                onClick={() => anbieterWechseln(id)}
              >
                {a.name}
              </button>
            ))}
          </div>

          <div className="kb-fragzeile" style={{ marginTop: 10 }}>
            <input
              className="kb-eingabe kb-eingabe--voll"
              type="password"
              placeholder={`API-Schlüssel für ${ANBIETER[anbieter].name}`}
              value={schluessel}
              onChange={(e) => setSchluessel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && modelleLaden()}
              autoComplete="off"
            />
            <button className="kb-btn kb-btn--stark" onClick={modelleLaden} disabled={pruefe || !schluessel.trim()}>
              {pruefe ? "prüfe …" : "Prüfen"}
            </button>
          </div>

          <p className="kb-info" style={{ marginTop: 10, marginBottom: 0 }}>
            Schlüssel gibt es unter{" "}
            <a href={ANBIETER[anbieter].url} target="_blank" rel="noopener noreferrer">
              {ANBIETER[anbieter].hilfe}
            </a>.{" "}
            <Hinweis kurz="Was passiert mit meinem Schlüssel?" titel="Dein API-Schlüssel">
              <p>
                Er bleibt in <strong>deinem Browser</strong> (localStorage) und wird bei
                jeder Frage einmal an den Server weitergereicht, der den Aufruf beim
                Anbieter macht. Gespeichert oder protokolliert wird er dort nicht.
              </p>
              <p>
                Direkt aus dem Browser ginge es nicht sauber — die Anbieter blockieren das.
                Der Schlüssel passiert also die Maschine, bleibt aber nicht dort.
              </p>
              <p>
                Abgerechnet wird über <strong>deinen eigenen Zugang</strong>, nicht über den
                Betreiber der Seite.
              </p>
            </Hinweis>
            {schluessel && (
              <>
                {" "}<button className="kb-textknopf" onClick={vergessen}>Schlüssel löschen</button>
              </>
            )}
          </p>

          {modelle.length > 0 && (
            <label className="kb-feld" style={{ marginTop: 12, marginBottom: 0 }}>
              <span className="kb-feld-name">Modell</span>
              <select
                className="kb-eingabe"
                value={modell}
                onChange={(e) => { setModell(e.target.value); sichern({ modell: e.target.value }); }}
              >
                {modelle.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="kb-fragzeile" style={{ marginTop: offen ? 14 : 0 }}>
        <input
          className="kb-eingabe kb-eingabe--voll"
          placeholder="z. B. Wen muss Lamlo verkaufen, um aus dem Minus zu kommen?"
          value={frage}
          maxLength={1000}
          onChange={(e) => setFrage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fragen()}
          disabled={laeuft}
        />
        <button className="kb-btn kb-btn--stark" onClick={() => fragen()} disabled={laeuft || !frage.trim()}>
          {laeuft ? "…" : "Fragen"}
        </button>
      </div>

      {bereit && !antwort && !laeuft && (
        <div className="kb-sortleiste kb-sortleiste--immer" style={{ marginTop: 10 }}>
          {BEISPIELE.map((b) => (
            <button key={b} className="kb-sortchip" onClick={() => { setFrage(b); fragen(b); }}>
              {b}
            </button>
          ))}
        </div>
      )}

      {fehler && <div className="kb-hinweis kb-hinweis--fehler" style={{ marginTop: 12 }}>{fehler}</div>}

      {(antwort || laeuft) && (
        <div className="kb-antwort">
          {antwort || "denkt nach …"}
          {laeuft && antwort && <span className="kb-cursor" />}
        </div>
      )}
    </section>
  );
}
