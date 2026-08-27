"use client";
import { useState, useMemo } from "react";
import { euro, euroKurz, prozent } from "@/lib/format";

// Was passiert mit meinem Konto, wenn ich diese Spieler kaufe — und wenn ich
// dafür andere verkaufe?
//
// Beide Seiten gehören zusammen: Ein Kauf hängt meist daran, dass vorher
// etwas raus muss. Deshalb steht der eigene Kader gleich mit hier, statt auf
// einer anderen Seite.
//
// Zwei Regler, weil beide Richtungen ihre eigene Unsicherheit haben:
//
//   Kauf     Zum Marktwert bekommt man selten jemanden — man bietet darüber.
//   Verkauf  An Kickbase gibt es genau den Marktwert. Verkauft man an einen
//            Mitspieler, kann dessen Gebot darüber liegen.
//
// Wichtig bleibt die Grenze: Ein Kauf hebt den Teamwert und damit das
// erlaubte Minus (Teamwert ÷ 3), ein Verkauf senkt beides. Maßgeblich ist
// deshalb nicht der Kontostand danach, sondern die Luft bis zur Grenze.
export default function Kaufrechner({
  gewaehlt,
  konto,
  teamwert,
  ligaAufschlag = null,
  aufLeeren,
  eigenerKader = [],
}) {
  const [aufschlag, setAufschlag] = useState(0);
  const [erloesAufschlag, setErloesAufschlag] = useState(0);
  const [verkauft, setVerkauft] = useState(() => new Set());
  const [kaderOffen, setKaderOffen] = useState(false);

  const r = useMemo(() => {
    const kaufMW = gewaehlt.reduce((s, x) => s + Number(x.marktwert ?? 0), 0);
    const kosten = Math.round(kaufMW * (1 + aufschlag / 100));

    const raus = eigenerKader.filter((x) => verkauft.has(String(x.id)));
    const verkaufMW = raus.reduce((s, x) => s + Number(x.marktwert ?? 0), 0);
    const erloes = Math.round(verkaufMW * (1 + erloesAufschlag / 100));

    const neuesKonto = konto - kosten + erloes;
    const neuerTeamwert = Math.max(0, teamwert + kaufMW - verkaufMW);
    const neuesLimit = Math.floor(neuerTeamwert / 3);

    return {
      kaufMW, kosten, verkaufMW, erloes, anzahlRaus: raus.length,
      neuesKonto, neuerTeamwert, neuesLimit,
      rest: neuesKonto + neuesLimit,
      machbar: neuesKonto + neuesLimit >= 0,
    };
  }, [gewaehlt, eigenerKader, verkauft, konto, teamwert, aufschlag, erloesAufschlag]);

  const nichts = gewaehlt.length === 0 && r.anzahlRaus === 0;

  function umschaltenVerkauf(id) {
    setVerkauft((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }

  function allesLeeren() {
    setVerkauft(new Set());
    aufLeeren?.();
  }

  const kaderNachWert = useMemo(
    () => [...eigenerKader].sort((a, b) => Number(b.marktwert ?? 0) - Number(a.marktwert ?? 0)),
    [eigenerKader]
  );

  return (
    <div className={`kb-rechner${nichts ? "" : r.machbar ? " kb-rechner--gut" : " kb-rechner--eng"}`}>
      <div className="kb-kennzahlen">
        <div>
          <span className="kb-label">
            {gewaehlt.length === 0 ? "Kein Kauf gewählt" : `Kauf von ${gewaehlt.length}`}
          </span>
          <strong className={r.kosten > 0 ? "kb-minus" : undefined}>
            {r.kosten > 0 ? "−" : ""}{euro(r.kosten)}
          </strong>
          {aufschlag > 0 && <span className="kb-leise"> statt {euroKurz(r.kaufMW)}</span>}
        </div>
        <div>
          <span className="kb-label">
            {r.anzahlRaus === 0 ? "Kein Verkauf gewählt" : `Verkauf von ${r.anzahlRaus}`}
          </span>
          <strong className={r.erloes > 0 ? "kb-plus" : undefined}>
            {r.erloes > 0 ? "+" : ""}{euro(r.erloes)}
          </strong>
          {erloesAufschlag > 0 && <span className="kb-leise"> statt {euroKurz(r.verkaufMW)}</span>}
        </div>
        <div>
          <span className="kb-label">Kontostand danach</span>
          <strong className={r.neuesKonto < 0 ? "kb-minus" : "kb-plus"}>{euro(r.neuesKonto)}</strong>
        </div>
        <div>
          <span className="kb-label">Erlaubtes Minus danach</span>
          {euro(r.neuesLimit)}
          <span className="kb-leise"> Teamwert {euroKurz(r.neuerTeamwert)}</span>
        </div>
        <div>
          <span className="kb-label">Luft bis zur Grenze</span>
          <strong className={r.rest < 0 ? "kb-minus" : undefined}>{euro(r.rest)}</strong>
        </div>
      </div>

      <div className="kb-regler">
        <label className="kb-aufschlagregler">
          <span className="kb-label">Aufschlag beim Kauf: <strong>{aufschlag} %</strong></span>
          <input type="range" min={0} max={50} step={1} value={aufschlag}
                 onChange={(e) => setAufschlag(Number(e.target.value))} />
        </label>

        <label className="kb-aufschlagregler">
          <span className="kb-label">Über Marktwert verkauft: <strong>{erloesAufschlag} %</strong></span>
          <input type="range" min={0} max={50} step={1} value={erloesAufschlag}
                 onChange={(e) => setErloesAufschlag(Number(e.target.value))} />
        </label>
      </div>

      <div className="kb-rechner-fuss">
        <span>
          {nichts ? (
            "Spieler in der Liste antippen zum Einplanen."
          ) : r.machbar ? (
            <span className="kb-plus">
              <strong>Geht.</strong> Danach bleiben {euro(r.rest)} Luft bis zum erlaubten Minus.
            </span>
          ) : (
            <span className="kb-minus">
              <strong>Geht nicht.</strong> {euro(-r.rest)} zu wenig — mehr verkaufen oder
              weniger kaufen.
            </span>
          )}
        </span>

        <span className="kb-rechner-knoepfe">
          {eigenerKader.length > 0 && (
            <button className="kb-btn" onClick={() => setKaderOffen(!kaderOffen)}>
              {kaderOffen ? "Kader zuklappen" : `Eigenen Kader zeigen (${eigenerKader.length})`}
            </button>
          )}
          {ligaAufschlag != null && (
            <button className="kb-btn"
                    onClick={() => setAufschlag(Math.min(50, Math.max(0, Math.round(ligaAufschlag * 100))))}>
              Liga-Schnitt {prozent(ligaAufschlag)}
            </button>
          )}
          {!nichts && <button className="kb-btn" onClick={allesLeeren}>Auswahl leeren</button>}
        </span>
      </div>

      {kaderOffen && eigenerKader.length > 0 && (
        <div className="kb-eigenerkader">
          <span className="kb-label">Zum Verkaufen antippen</span>
          <div className="kb-kaderband">
            {kaderNachWert.map((s) => {
              const aktiv = verkauft.has(String(s.id));
              return (
                <button
                  key={s.id}
                  className={`kb-kaderchip${aktiv ? " kb-kaderchip--aktiv" : ""}`}
                  onClick={() => umschaltenVerkauf(String(s.id))}
                  aria-pressed={aktiv}
                >
                  {s.name}
                  <span className="kb-leise"> {euroKurz(s.marktwert)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
