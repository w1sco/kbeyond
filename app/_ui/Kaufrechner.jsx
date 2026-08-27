"use client";
import { useState, useMemo } from "react";
import { euro, prozent } from "@/lib/format";

// Was passiert mit meinem Konto, wenn ich diese Spieler kaufe?
//
// Gerechnet wird mit dem Marktwert plus einem Aufschlag, den man selbst
// einstellt — denn zum Marktwert bekommt man selten jemanden. Wie hoch der
// in dieser Liga üblicherweise ausfällt, steht auf der Ligaseite unter
// "Aufschläge"; der dort gemessene Wert lässt sich hier per Klick übernehmen.
//
// Wichtig ist die Grenze: Ein Kauf erhöht auch den Teamwert und damit das
// erlaubte Minus (Teamwert ÷ 3). Wer für 20 Mio kauft, darf danach also
// rund 6,7 Mio tiefer ins Minus als vorher — sonst käme die Rechnung zu
// pessimistisch heraus.
export default function Kaufrechner({ gewaehlt, konto, teamwert, ligaAufschlag = null, aufLeeren }) {
  const [aufschlag, setAufschlag] = useState(0);

  const r = useMemo(() => {
    const summeMarktwert = gewaehlt.reduce((s, x) => s + Number(x.marktwert ?? 0), 0);
    const kosten = Math.round(summeMarktwert * (1 + aufschlag / 100));

    const neuesKonto = konto - kosten;
    const neuerTeamwert = teamwert + summeMarktwert;
    const neuesLimit = Math.floor(neuerTeamwert / 3);

    return {
      summeMarktwert,
      kosten,
      neuesKonto,
      neuerTeamwert,
      neuesLimit,
      // Wie viel Luft bleibt bis zur Grenze des erlaubten Minus?
      rest: neuesKonto + neuesLimit,
      machbar: neuesKonto + neuesLimit >= 0,
    };
  }, [gewaehlt, konto, teamwert, aufschlag]);

  const nichts = gewaehlt.length === 0;

  return (
    <div className={`kb-rechner${nichts ? "" : r.machbar ? " kb-rechner--gut" : " kb-rechner--eng"}`}>
      <div className="kb-kennzahlen">
        <div>
          <span className="kb-label">
            {nichts ? "Nichts gewählt" : `Kauf von ${gewaehlt.length} Spieler${gewaehlt.length === 1 ? "" : "n"}`}
          </span>
          <strong>{euro(r.kosten)}</strong>
          {aufschlag > 0 && (
            <span className="kb-leise"> statt {euro(r.summeMarktwert)}</span>
          )}
        </div>
        <div>
          <span className="kb-label">Kontostand danach</span>
          <strong className={r.neuesKonto < 0 ? "kb-minus" : "kb-plus"}>{euro(r.neuesKonto)}</strong>
        </div>
        <div>
          <span className="kb-label">Erlaubtes Minus danach</span>
          {euro(r.neuesLimit)}
          <span className="kb-leise"> Teamwert {euro(r.neuerTeamwert)}</span>
        </div>
        <div>
          <span className="kb-label">Luft bis zur Grenze</span>
          <strong className={r.rest < 0 ? "kb-minus" : undefined}>{euro(r.rest)}</strong>
        </div>
      </div>

      <div className="kb-aufschlagzeile">
        <label className="kb-aufschlagregler">
          <span className="kb-label">
            Angenommener Aufschlag: <strong>{aufschlag} %</strong>
          </span>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={aufschlag}
            onChange={(e) => setAufschlag(Number(e.target.value))}
          />
        </label>

        <span className="kb-rechner-knoepfe">
          {ligaAufschlag != null && (
            <button
              className="kb-btn"
              onClick={() => setAufschlag(Math.min(50, Math.max(0, Math.round(ligaAufschlag * 100))))}
            >
              Liga-Schnitt {prozent(ligaAufschlag)}
            </button>
          )}
          {!nichts && (
            <button className="kb-btn" onClick={aufLeeren}>Auswahl leeren</button>
          )}
        </span>
      </div>

      {!nichts && (
        <div className="kb-rechner-fuss">
          {r.machbar ? (
            <span className="kb-plus">
              <strong>Geht.</strong> Danach bleiben {euro(r.rest)} Luft bis zum erlaubten Minus.
            </span>
          ) : (
            <span className="kb-minus">
              <strong>Geht nicht.</strong> {euro(-r.rest)} zu wenig — erst verkaufen oder
              weniger nehmen.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
