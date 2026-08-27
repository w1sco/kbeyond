"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { euro, euroKurz } from "@/lib/format";

// Teamwert-Verlauf aller Manager.
//
// Zwölf farbige Linien wären nicht lesbar. Deshalb liegen alle Linien
// zurückhaltend grau im Hintergrund und nur die ausgewählten bekommen ihre
// Farbe — anklicken in der Leiste darunter. So sieht man das Feld und
// zugleich den eigenen Weg darin.
//
// Die Farben sind fest an den Manager gebunden (Reihenfolge nach ID), nicht
// an seinen Rang: eine Auswahl darf die übrigen nicht umfärben.

// Geprüfte kategoriale Palette, in dieser Reihenfolge.
const FARBEN = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
  "#e87ba4", "#008300", "#4a3aa7", "#e34948",
];

const MAX_FARBIG = FARBEN.length;

// Zwei Geometrien. Ein Seitenverhältnis für beide gibt es nicht: derselbe
// viewBox, der auf dem Desktop gut liegt, wird auf einem 360-px-Display zu
// einem Streifen mit unlesbarer Schrift.
const BREIT = { breite: 860, hoehe: 340, links: 62, rechts: 96, oben: 14, unten: 30, schrift: 11, namen: true };
const SCHMAL = { breite: 420, hoehe: 340, links: 66, rechts: 12, oben: 12, unten: 26, schrift: 12, namen: false };

function useSchmal() {
  const [schmal, setSchmal] = useState(false);
  useEffect(() => {
    const abfrage = window.matchMedia("(max-width: 640px)");
    const merke = () => setSchmal(abfrage.matches);
    merke();
    abfrage.addEventListener("change", merke);
    return () => abfrage.removeEventListener("change", merke);
  }, []);
  return schmal;
}

// Direkte Beschriftungen dürfen sich nicht überdecken: nach Höhe sortieren
// und auseinanderschieben, wenn zwei Linien fast gleich enden.
function entzerre(marken, mindestAbstand = 15) {
  const sortiert = [...marken].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sortiert.length; i++) {
    const luecke = sortiert[i].y - sortiert[i - 1].y;
    if (luecke < mindestAbstand) sortiert[i].y = sortiert[i - 1].y + mindestAbstand;
  }
  return sortiert;
}

export default function Verlauf({ tage, reihen, manager, meineId }) {
  const schmal = useSchmal();
  const B = schmal ? SCHMAL : BREIT;
  // Von Haus aus die eigene Linie – der häufigste Blick
  const [gewaehlt, setGewaehlt] = useState(() => {
    const start = new Set();
    if (meineId != null && reihen[String(meineId)]) start.add(String(meineId));
    return start;
  });
  const [beiTag, setBeiTag] = useState(null);
  const flaeche = useRef(null);

  const daten = useMemo(() => {
    const alleWerte = [];
    for (const werte of Object.values(reihen)) {
      for (const w of werte) if (w != null) alleWerte.push(w);
    }
    if (alleWerte.length === 0) return null;

    let min = Math.min(...alleWerte);
    let max = Math.max(...alleWerte);
    // Etwas Luft, damit Linien nicht am Rand kleben
    const luft = (max - min) * 0.08 || max * 0.05 || 1;
    min -= luft;
    max += luft;

    const innenB = B.breite - B.links - B.rechts;
    const innenH = B.hoehe - B.oben - B.unten;
    const x = (i) => B.links + (tage.length === 1 ? innenB / 2 : (i / (tage.length - 1)) * innenB);
    const y = (w) => B.oben + innenH - ((w - min) / (max - min)) * innenH;

    // Vier Gitterlinien reichen, mehr lenkt von den Daten ab
    const striche = [0, 1, 2, 3, 4].map((k) => min + ((max - min) * k) / 4);

    return { min, max, x, y, striche };
  }, [tage, reihen, B]);

  // Farbe hängt am Manager, nicht an der Auswahl
  const farbeVon = useMemo(() => {
    const m = new Map();
    manager.forEach((mg, i) => {
      if (i < MAX_FARBIG) m.set(String(mg.id), FARBEN[i]);
    });
    return m;
  }, [manager]);

  if (!daten) {
    return (
      <p className="kb-info">
        Noch kein Verlauf gespeichert. Nach der zweiten Aktualisierung mit geänderten
        Teamwerten entsteht die erste Linie.
      </p>
    );
  }

  const { x, y, striche } = daten;

  function umschalten(id) {
    setGewaehlt((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else if (neu.size < MAX_FARBIG) neu.add(id);
      return neu;
    });
  }

  function zeigeTag(e) {
    const r = flaeche.current?.getBoundingClientRect();
    if (!r) return;
    const anteil = (e.clientX - r.left) / r.width;
    const innenAnteil = (anteil * B.breite - B.links) / (B.breite - B.links - B.rechts);
    const i = Math.round(innenAnteil * (tage.length - 1));
    setBeiTag(i >= 0 && i < tage.length ? i : null);
  }

  function pfad(werte) {
    let d = "";
    let offen = false;
    werte.forEach((w, i) => {
      if (w == null) { offen = false; return; }
      d += `${offen ? "L" : "M"}${x(i).toFixed(1)} ${y(w).toFixed(1)} `;
      offen = true;
    });
    return d.trim();
  }

  const gewaehlteListe = manager.filter((m) => gewaehlt.has(String(m.id)));
  const tagText = (i) =>
    new Date(tage[i]).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

  return (
    <>
      <div className="kb-diagramm" ref={flaeche}>
        <svg
          viewBox={`0 0 ${B.breite} ${B.hoehe}`}
          style={{ fontSize: `${B.schrift}px` }}
          role="img"
          aria-label="Teamwert-Verlauf aller Manager"
          onPointerMove={zeigeTag}
          onPointerLeave={() => setBeiTag(null)}
        >
          {striche.map((w, k) => (
            <g key={k}>
              <line
                x1={B.links} x2={B.breite - B.rechts} y1={y(w)} y2={y(w)}
                className="kb-gitter"
              />
              <text x={B.links - 8} y={y(w) + 4} className="kb-achse" textAnchor="end">
                {euroKurz(Math.round(w))}
              </text>
            </g>
          ))}

          {tage.map((t, i) => {
            // Etwa sieben Datumsangaben, und die letzte nur, wenn sie nicht
            // in die vorherige läuft.
            const jeder = Math.max(1, Math.ceil(tage.length / (B.namen ? 7 : 5)));
            const letzte = tage.length - 1;
            const istRaster = i % jeder === 0;
            const zuNahAmEnde = letzte - i < jeder / 2;
            if (i === letzte) {
              if (letzte % jeder === 0) return null;
            } else if (!istRaster || zuNahAmEnde) {
              return null;
            }
            return (
              <text key={i} x={x(i)} y={B.hoehe - 10} className="kb-achse" textAnchor="middle">
                {tagText(i)}
              </text>
            );
          })}

          {/* Erst alle grau, dann die gewählten darüber – so verdecken die
              Hintergrundlinien die farbigen nicht. */}
          {manager.map((m) => {
            const werte = reihen[String(m.id)];
            if (!werte || gewaehlt.has(String(m.id))) return null;
            return <path key={m.id} d={pfad(werte)} className="kb-linie kb-linie--leise" />;
          })}

          {gewaehlteListe.map((m) => {
            const werte = reihen[String(m.id)];
            if (!werte) return null;
            const farbe = farbeVon.get(String(m.id)) ?? "var(--kb-text)";
            return <path key={m.id} d={pfad(werte)} className="kb-linie" style={{ stroke: farbe }} />;
          })}

          {/* Direkte Beschriftung: die Farbe allein soll die Identität nicht
              allein tragen. Auf dem Handy fehlt rechts der Platz — dort
              übernehmen Legende und Tooltip diese Rolle. */}
          {B.namen && gewaehlteListe.length <= 4 &&
            entzerre(
              gewaehlteListe
                .map((m) => {
                  const werte = reihen[String(m.id)];
                  const i = werte ? werte.reduce((b, w, k) => (w != null ? k : b), -1) : -1;
                  return i < 0 ? null : { id: m.id, name: m.name, x: x(i) + 8, y: y(werte[i]) + 4 };
                })
                .filter(Boolean)
            ).map((mark) => (
              <text key={mark.id} x={mark.x} y={mark.y} className="kb-linienname">
                {mark.name}
              </text>
            ))}

          {beiTag != null && (
            <>
              <line
                x1={x(beiTag)} x2={x(beiTag)} y1={B.oben} y2={B.hoehe - B.unten}
                className="kb-fadenkreuz"
              />
              {gewaehlteListe.map((m) => {
                const w = reihen[String(m.id)]?.[beiTag];
                if (w == null) return null;
                return (
                  <circle
                    key={m.id} cx={x(beiTag)} cy={y(w)} r={4.5}
                    style={{ fill: farbeVon.get(String(m.id)) ?? "var(--kb-text)" }}
                    className="kb-punkt"
                  />
                );
              })}
            </>
          )}
        </svg>

        {beiTag != null && gewaehlteListe.length > 0 && (
          <div className={`kb-tooltip${!schmal && beiTag > tage.length / 2 ? " kb-tooltip--links" : ""}`}>
            <div className="kb-tooltip-tag">{tagText(beiTag)}, 0 Uhr</div>
            {gewaehlteListe
              .map((m) => ({ m, w: reihen[String(m.id)]?.[beiTag] }))
              .sort((a, b) => (b.w ?? -1) - (a.w ?? -1))
              .map(({ m, w }) => (
                <div key={m.id} className="kb-tooltip-zeile">
                  <span className="kb-punktfarbe" style={{ background: farbeVon.get(String(m.id)) }} />
                  <span className="kb-tooltip-name">{m.name}</span>
                  <span className="kb-tooltip-wert">{w == null ? "–" : euro(w)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="kb-legende-band">
        {manager.map((m) => {
          const an = gewaehlt.has(String(m.id));
          const farbe = farbeVon.get(String(m.id));
          const hatDaten = Boolean(reihen[String(m.id)]);
          return (
            <button
              key={m.id}
              className={`kb-legendenchip${an ? " kb-legendenchip--an" : ""}`}
              onClick={() => umschalten(String(m.id))}
              disabled={!hatDaten}
              title={hatDaten ? undefined : "Für diesen Manager ist noch kein Verlauf gespeichert"}
            >
              <span
                className="kb-punktfarbe"
                style={{ background: an && farbe ? farbe : "var(--kb-rand-stark)" }}
              />
              {m.name}
            </button>
          );
        })}
      </div>

      {gewaehlt.size >= MAX_FARBIG && (
        <p className="kb-info" style={{ marginTop: 8 }}>
          Mehr als {MAX_FARBIG} Linien lassen sich farblich nicht mehr sicher
          auseinanderhalten — erst eine abwählen.
        </p>
      )}
    </>
  );
}
