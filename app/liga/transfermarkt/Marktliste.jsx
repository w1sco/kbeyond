"use client";
import { useState, useMemo } from "react";
import { euro, euroKurz, restzeit } from "@/lib/format";
import Kaufrechner from "../../_ui/Kaufrechner";
import Startelf from "../../_ui/Startelf";

const QUELLEN = [
  { schluessel: "alle", label: "Alle" },
  { schluessel: "kickbase", label: "Nur Kickbase" },
  { schluessel: "mitspieler", label: "Nur Mitspieler" },
];

const SPALTEN = [
  { key: "name", label: "Spieler", text: true },
  { key: "position", label: "Pos.", text: true, sek: true },
  { key: "marktwert", label: "Marktwert" },
  { key: "trend", label: "Trend", sek: true },
  { key: "schnitt", label: "Ø Punkte" },
  { key: "proPunkt", label: "€/Punkt", klein: true },
  { key: "punkte", label: "Punkte", sek: true },
  { key: "restSek", label: "Rest", sek: true, klein: true },
  { key: "anbieter", label: "Anbieter", text: true, sek: true },
];

export default function Marktliste({ angebote, konto = null, teamwert = 0, ligaAufschlag = null, eigenerKader = [], boni = null }) {
  const [gewaehlt, setGewaehlt] = useState(() => new Set());
  const [quelle, setQuelle] = useState("alle");
  const [sortKey, setSortKey] = useState("marktwert");
  const [absteigend, setAbsteigend] = useState(true);
  const [suche, setSuche] = useState("");

  function umschalten(id) {
    setGewaehlt((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }

  const zeilen = useMemo(() => {
    const s = suche.trim().toLowerCase();
    let gefiltert = angebote;
    if (quelle === "kickbase") gefiltert = gefiltert.filter((a) => a.vonKickbase);
    if (quelle === "mitspieler") gefiltert = gefiltert.filter((a) => !a.vonKickbase);
    if (s) gefiltert = gefiltert.filter((a) => (a.name ?? "").toLowerCase().includes(s));

    const kopie = [...gefiltert];
    const spalte = SPALTEN.find((x) => x.key === sortKey);
    kopie.sort((a, b) => {
      if (spalte?.text) {
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        return absteigend ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      }
      // Fehlende Werte immer ans Ende, egal in welche Richtung sortiert wird
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // Bei €/Punkt ist klein besser – deshalb dreht "absteigend" hier um
      const richtung = spalte?.klein ? -1 : 1;
      return (absteigend ? bv - av : av - bv) * richtung;
    });
    return kopie;
  }, [angebote, quelle, sortKey, absteigend, suche]);

  function klick(key) {
    if (key === sortKey) setAbsteigend(!absteigend);
    else {
      setSortKey(key);
      setAbsteigend(!SPALTEN.find((x) => x.key === key)?.text);
    }
  }

  const pfeil = (key) => (key === sortKey ? (absteigend ? " ▼" : " ▲") : "");

  function wert(a, key) {
    const leer = <span className="kb-gedaempft">–</span>;
    switch (key) {
      case "name":
        return (
          <span className="kb-spielerzeile">
            {/* Kein Platzhalterkreis, wenn Kickbase kein Bild liefert –
                eine leere Scheibe vor jedem Namen sagt nichts aus. */}
            {a.bild && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="kb-spielerbild" src={a.bild} alt="" loading="lazy" />
            )}
            <span className="kb-spielername">{a.name}</span>
            <Startelf wert={a.startelf} />
          </span>
        );
      case "position":
        return a.position ?? leer;
      case "marktwert":
        return a.marktwert == null ? leer : (
          <>
            <span className="kb-voll">{euro(a.marktwert)}</span>
            <span className="kb-kurz">{euroKurz(a.marktwert)}</span>
          </>
        );
      case "trend":
        if (a.trend == null) return leer;
        if (a.trend === 0) return <span className="kb-gedaempft">±0</span>;
        return (
          <span className={a.trend < 0 ? "kb-minus" : "kb-plus"}>
            {a.trend > 0 ? "+" : ""}{euroKurz(a.trend)}
          </span>
        );
      case "schnitt":
        return a.schnitt == null ? leer : a.schnitt.toLocaleString("de-DE", { maximumFractionDigits: 1 });
      case "proPunkt":
        return a.proPunkt == null ? leer : euroKurz(Math.round(a.proPunkt));
      case "punkte":
        return a.punkte == null ? leer : a.punkte.toLocaleString("de-DE");
      case "restSek":
        return a.restSek == null ? leer : restzeit(a.restSek);
      case "anbieter":
        return a.vonKickbase
          ? <span className="kb-gedaempft">Kickbase</span>
          : (a.anbieter ?? <span className="kb-gedaempft">Mitspieler</span>);
      default:
        return leer;
    }
  }

  const vonKickbase = angebote.filter((a) => a.vonKickbase).length;

  return (
    <>
      <div className="kb-status">
        <div><span className="kb-label">Angebote</span><strong>{angebote.length}</strong></div>
        <div><span className="kb-label">Von Kickbase</span>{vonKickbase}</div>
        <div><span className="kb-label">Von Mitspielern</span>{angebote.length - vonKickbase}</div>
        <div><span className="kb-label">Angezeigt</span>{zeilen.length}</div>
      </div>

      <div className="kb-sortleiste kb-sortleiste--immer">
        {QUELLEN.map((q) => (
          <button
            key={q.schluessel}
            className={`kb-sortchip${quelle === q.schluessel ? " kb-sortchip--aktiv" : ""}`}
            onClick={() => setQuelle(q.schluessel)}
          >
            {q.label}
          </button>
        ))}
      </div>

      <input
        className="kb-eingabe kb-eingabe--voll"
        style={{ margin: "4px 0 12px" }}
        placeholder="Spieler suchen …"
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
      />

      {konto != null && (
        <Kaufrechner
          gewaehlt={zeilen.filter((a) => gewaehlt.has(String(a.id)))}
          konto={konto}
          teamwert={teamwert}
          ligaAufschlag={ligaAufschlag}
          eigenerKader={eigenerKader}
          boni={boni}
          aufLeeren={() => setGewaehlt(new Set())}
        />
      )}

      {zeilen.length === 0 ? (
        <p className="kb-info">Kein Angebot passt.</p>
      ) : (
        <div className="kb-tabellenrahmen">
          <table className="kb-tabelle kb-tabelle--schmal">
            <thead>
              <tr>
                {konto != null && <th className="kb-wahlspalte" aria-label="Auswahl" />}
                {SPALTEN.map((s, i) => (
                  <th
                    key={s.key}
                    scope="col"
                    tabIndex={0}
                    className={`${i === 0 ? "kb-namensspalte" : ""}${s.sek ? " kb-sek" : ""}${s.key === sortKey ? " kb-aktiv" : ""}`}
                    onClick={() => klick(s.key)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && klick(s.key)}
                  >
                    {s.label}{pfeil(s.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zeilen.map((a, i) => (
                <tr
                  key={a.id}
                  className={`${konto != null ? "kb-klickzeile " : ""}${
                    gewaehlt.has(String(a.id))
                      ? "kb-zeile--gewaehlt"
                      : i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"
                  }`}
                  onClick={konto != null ? () => umschalten(String(a.id)) : undefined}
                >
                  {konto != null && (
                    <td className="kb-wahlspalte">
                      <input
                        type="checkbox"
                        checked={gewaehlt.has(String(a.id))}
                        onChange={() => umschalten(String(a.id))}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${a.name} einplanen`}
                      />
                    </td>
                  )}
                  {SPALTEN.map((s, k) => (
                    <td
                      key={s.key}
                      className={`${k === 0 ? "kb-namensspalte" : ""}${s.sek ? " kb-sek" : ""}`.trim() || undefined}
                    >
                      {wert(a, s.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="kb-legende">{zeilen.length} von {angebote.length} Angeboten</p>
    </>
  );
}
