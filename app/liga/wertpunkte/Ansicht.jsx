"use client";
import { useState, useMemo, useRef, useEffect, useId } from "react";
import { euro, euroKurz } from "@/lib/format";
import Schloss from "../../_ui/Schloss";

// Wert und Punkte: Gesamtwert (Teamwert + Konto) gegen Saisonpunkte.
//
// Zwei Diagramme mit denselben Achsen — Punkte nach rechts, Gesamtwert
// nach oben — und eine Tabelle:
//
//   Heute:          ein Punkt je Manager, dazu die Gerade der Liga.
//                   Wer darüber liegt, hat mehr Vermögen, als seine
//                   Punkte erwarten lassen; wer darunter liegt, holt mehr
//                   aus weniger.
//   Saisonverlauf:  der Weg jedes Managers dorthin, Tag für Tag. Alle grau,
//                   gewählte farbig — dieselbe Bedienung wie im Verlauf
//                   auf der Ligaseite.

const FARBEN = [
  "var(--kb-serie-1)", "var(--kb-serie-2)", "var(--kb-serie-3)", "var(--kb-serie-4)",
  "var(--kb-serie-5)", "var(--kb-serie-6)", "var(--kb-serie-7)", "var(--kb-serie-8)",
];
const MAX_FARBIG = FARBEN.length;

// Dieselben zwei Geometrien wie im Verlauf; rechts braucht es hier keinen
// Platz für Namen am Linienende, die Namen stehen an den Punkten.
const BREIT = { breite: 860, hoehe: 380, links: 62, rechts: 24, oben: 14, unten: 40, schrift: 11, namen: true };
const SCHMAL = { breite: 420, hoehe: 380, links: 58, rechts: 12, oben: 12, unten: 38, schrift: 12, namen: false };

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

// Runde Achsenschritte: 1, 2 oder 5 mal einer Zehnerpotenz.
function schritte(min, max, anzahl = 5, ganz = false) {
  const roh = (max - min) / anzahl || 1;
  const p = 10 ** Math.floor(Math.log10(roh));
  let s = [1, 2, 5, 10].map((f) => f * p)
    .reduce((best, f) => (Math.abs((max - min) / f - anzahl) < Math.abs((max - min) / best - anzahl) ? f : best));
  if (ganz) s = Math.max(1, Math.round(s));
  const raus = [];
  for (let w = Math.ceil(min / s) * s; w <= max + 1e-9; w += s) raus.push(w);
  return raus;
}

// Die Skala über alle Werte, die ein Diagramm zeigt. Punkte beginnen bei 0:
// Der Abstand zum Ursprung ist hier die Aussage („wie weit ist er“).
// Der Gesamtwert nicht — sonst klebte alles oben am Rand.
function skala(punkte, B) {
  if (punkte.length === 0) return null;
  const xs = punkte.map((p) => p.x);
  const ys = punkte.map((p) => p.y);
  const xMax = Math.max(...xs, 1) * 1.05;
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  const luft = (yMax - yMin) * 0.08 || Math.abs(yMax) * 0.05 || 1;
  yMin -= luft;
  yMax += luft;
  const innenB = B.breite - B.links - B.rechts;
  const innenH = B.hoehe - B.oben - B.unten;
  return {
    xMax, yMin, yMax,
    x: (w) => B.links + (w / xMax) * innenB,
    y: (w) => B.oben + innenH - ((w - yMin) / (yMax - yMin)) * innenH,
    xStriche: schritte(0, xMax, 5, true),
    yStriche: schritte(yMin, yMax, 4),
  };
}

function Achsen({ s, B }) {
  return (
    <>
      {s.yStriche.map((w) => (
        <g key={`y${w}`}>
          <line x1={B.links} x2={B.breite - B.rechts} y1={s.y(w)} y2={s.y(w)} className="kb-gitter" />
          <text x={B.links - 8} y={s.y(w) + 4} className="kb-achse" textAnchor="end">{euroKurz(w)}</text>
        </g>
      ))}
      {s.xStriche.map((w) => (
        <text key={`x${w}`} x={s.x(w)} y={B.hoehe - B.unten + 16} className="kb-achse" textAnchor="middle">
          {w.toLocaleString("de-DE")}
        </text>
      ))}
      <text x={B.breite - B.rechts} y={B.hoehe - 4} className="kb-achse" textAnchor="end">Punkte →</text>
    </>
  );
}

// Der Punkt, der dem Zeiger am nächsten liegt — in Bildschirmabstand, nicht
// in Daten: 100 Punkte und 1 Mio sind keine vergleichbaren Strecken.
function naechster(e, svg, B, kandidaten) {
  const r = svg?.getBoundingClientRect();
  if (!r) return null;
  const px = ((e.clientX - r.left) / r.width) * B.breite;
  const py = ((e.clientY - r.top) / r.height) * B.hoehe;
  let best = null;
  for (const k of kandidaten) {
    const d = Math.hypot(k.sx - px, k.sy - py);
    if (d < 40 && (!best || d < best.d)) best = { ...k, d };
  }
  return best;
}

// Der Name steht rechts vom Punkt — am rechten Rand links davon, sonst
// liefe er aus dem Bild.
function marke(id, name, sx, sy, B, ich = false) {
  const links = sx > B.breite - B.rechts - 80;
  return { id, name, ich, x: links ? sx - 9 : sx + 9, y: sy + 4, anker: links ? "end" : "start" };
}

// Namen an den Punkten dürfen sich nicht überdecken: wer zu dicht über
// einem anderen steht, rückt nach unten.
function entzerre(marken, abstand = 14) {
  const sortiert = [...marken].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sortiert.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = sortiert[j];
      const b = sortiert[i];
      const nebeneinander = Math.abs(a.x - b.x) < 90;
      if (nebeneinander && b.y - a.y < abstand) b.y = a.y + abstand;
    }
  }
  return sortiert;
}

export default function Ansicht({ zeilen, trend, pfade, meineId, manager }) {
  const schmal = useSchmal();
  const B = schmal ? SCHMAL : BREIT;

  // Farbe hängt fest am Manager (Reihenfolge nach ID), nicht an der Auswahl.
  const farbeVon = useMemo(() => {
    const m = new Map();
    manager.forEach((mg, i) => { if (i < MAX_FARBIG) m.set(String(mg.id), FARBEN[i]); });
    return m;
  }, [manager]);

  return (
    <>
      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">Heute</h2>
        <Wolke zeilen={zeilen} trend={trend} meineId={meineId} B={B} schmal={schmal} />
      </section>

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">Saisonverlauf</h2>
        <Wege pfade={pfade} manager={manager} meineId={meineId} farbeVon={farbeVon} B={B} schmal={schmal} />
      </section>

      <Tabelle zeilen={zeilen} trend={trend} meineId={meineId} />
    </>
  );
}

const vorzeichen = (w) => (w > 0 ? "+" : "") + euroKurz(w);

function Wolke({ zeilen, trend, meineId, B, schmal }) {
  const svg = useRef(null);
  const rahmen = useId();
  const [bei, setBei] = useState(null);
  const sichtbar = zeilen.filter((z) => z.gesamt != null);
  const s = useMemo(
    () => skala(sichtbar.map((z) => ({ x: z.punkte, y: z.gesamt })), B),
    [sichtbar, B]);

  if (!s) return <p className="kb-info">Noch kein Manager mit Gesamtwert — einmal aktualisieren.</p>;

  const punkte = sichtbar.map((z) => ({ ...z, sx: s.x(z.punkte), sy: s.y(z.gesamt) }));
  const ich = (z) => String(z.id) === String(meineId);

  // Die Gerade von 0 bis zum Manager mit den meisten Punkten. Was über den
  // Rahmen hinausliefe, schneidet der clipPath ab — ein Festklemmen der
  // Enden würde ihre Steigung verfälschen.
  const linie = trend
    ? (() => {
        const bis = Math.max(...sichtbar.map((z) => z.punkte));
        return { x1: s.x(0), y1: s.y(trend.a), x2: s.x(bis), y2: s.y(trend.a + trend.b * bis) };
      })()
    : null;

  const marken = B.namen
    ? entzerre(punkte.map((p) => marke(p.id, p.name, p.sx, p.sy, B, ich(p))))
    : punkte.filter(ich).map((p) => marke(p.id, p.name, p.sx, p.sy, B, true));

  return (
    <div className="kb-diagramm">
      <svg
        ref={svg}
        viewBox={`0 0 ${B.breite} ${B.hoehe}`}
        style={{ fontSize: `${B.schrift}px` }}
        role="img"
        aria-label="Gesamtwert gegen Punkte je Manager"
        onPointerMove={(e) => setBei(naechster(e, svg.current, B, punkte))}
        onPointerLeave={() => setBei(null)}
      >
        <Achsen s={s} B={B} />
        <clipPath id={rahmen}>
          <rect x={B.links} y={B.oben} width={B.breite - B.links - B.rechts} height={B.hoehe - B.oben - B.unten} />
        </clipPath>
        {linie && <line {...linie} className="kb-trendgerade" clipPath={`url(#${rahmen})`} />}
        {punkte.map((p) => (
          <circle
            key={p.id} cx={p.sx} cy={p.sy} r={ich(p) ? 7 : 5.5}
            className={`kb-wolkenpunkt${ich(p) ? " kb-wolkenpunkt--ich" : ""}${bei?.id === p.id ? " kb-wolkenpunkt--bei" : ""}`}
          />
        ))}
        {marken.map((m) => (
          <text key={m.id} x={m.x} y={m.y} textAnchor={m.anker}
                className={`kb-linienname${m.ich ? " kb-linienname--ich" : ""}`}>
            {m.name}
          </text>
        ))}
      </svg>

      {bei && (
        <div className={`kb-tooltip${!schmal && bei.sx > B.breite / 2 ? " kb-tooltip--links" : ""}`}>
          <div className="kb-tooltip-tag">{bei.name}</div>
          <Zeile name="Punkte" wert={bei.punkte.toLocaleString("de-DE")} />
          <Zeile name="Gesamtwert" wert={euro(bei.gesamt)} />
          <Zeile name="je Punkt" wert={bei.mioJePunkt == null ? "–" : euro(bei.mioJePunkt)} />
          {bei.abstand != null && <Zeile name="zur Geraden" wert={vorzeichen(bei.abstand)} />}
        </div>
      )}

      <p className="kb-legende">
        {trend
          ? <>Gestrichelt: die Gerade der Liga — welcher Gesamtwert zu wie vielen Punkten passt
              ({euroKurz(trend.b)} je Punkt, Achsenabschnitt {euroKurz(trend.a)}).
              Darüber: mehr Vermögen, als die Punkte erwarten lassen. Darunter: mehr Punkte aus
              weniger Vermögen.</>
          : <>Für eine Gerade braucht es mindestens drei Manager mit unterschiedlich vielen Punkten.</>}
      </p>
    </div>
  );
}

function Wege({ pfade, manager, meineId, farbeVon, B, schmal }) {
  const svg = useRef(null);
  const [bei, setBei] = useState(null);
  const [gewaehlt, setGewaehlt] = useState(() => {
    const start = new Set();
    if (meineId != null && pfade[String(meineId)]?.length) start.add(String(meineId));
    return start;
  });

  const alle = useMemo(
    () => Object.values(pfade).flat().map((p) => ({ x: p.punkte, y: p.gesamt })),
    [pfade]);
  const s = useMemo(() => skala(alle, B), [alle, B]);

  if (!s) {
    return (
      <p className="kb-info">
        Noch kein Tag, an dem Punkte und Gesamtwert zugleich bekannt sind. Punkte stehen nur an
        Tagen, an denen aktualisiert wurde, und an Tagen ohne Spiel dazwischen.
      </p>
    );
  }

  const gewaehlteListe = manager.filter((m) => gewaehlt.has(String(m.id)));
  const pfadVon = (liste) =>
    liste.map((p, i) => `${i ? "L" : "M"}${s.x(p.punkte).toFixed(1)} ${s.y(p.gesamt).toFixed(1)}`).join(" ");

  const kandidaten = gewaehlteListe.flatMap((m) =>
    (pfade[String(m.id)] ?? []).map((p) => ({
      ...p, id: m.id, name: m.name, sx: s.x(p.punkte), sy: s.y(p.gesamt),
    })));

  function umschalten(id) {
    setGewaehlt((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else if (neu.size < MAX_FARBIG) neu.add(id);
      return neu;
    });
  }

  const tagText = (t) => `${t.slice(8, 10)}.${t.slice(5, 7)}.`;

  return (
    <>
      <div className="kb-diagramm">
        <svg
          ref={svg}
          viewBox={`0 0 ${B.breite} ${B.hoehe}`}
          style={{ fontSize: `${B.schrift}px` }}
          role="img"
          aria-label="Weg jedes Managers: Gesamtwert gegen Punkte über die Saison"
          onPointerMove={(e) => setBei(naechster(e, svg.current, B, kandidaten))}
          onPointerLeave={() => setBei(null)}
        >
          <Achsen s={s} B={B} />
          {manager.map((m) => {
            const liste = pfade[String(m.id)];
            if (!liste?.length || gewaehlt.has(String(m.id))) return null;
            return <path key={m.id} d={pfadVon(liste)} className="kb-linie kb-linie--leise" />;
          })}
          {gewaehlteListe.map((m) => {
            const liste = pfade[String(m.id)];
            if (!liste?.length) return null;
            const farbe = farbeVon.get(String(m.id)) ?? "var(--kb-text)";
            const letzter = liste[liste.length - 1];
            return (
              <g key={m.id}>
                <path d={pfadVon(liste)} className="kb-linie" style={{ stroke: farbe }} />
                <circle cx={s.x(letzter.punkte)} cy={s.y(letzter.gesamt)} r={4.5}
                        className="kb-wolkenpunkt" style={{ fill: farbe }} />
                {B.namen && gewaehlteListe.length <= 4 && (() => {
                  const mk = marke(m.id, m.name, s.x(letzter.punkte), s.y(letzter.gesamt), B);
                  return <text x={mk.x} y={mk.y} textAnchor={mk.anker} className="kb-linienname">{m.name}</text>;
                })()}
              </g>
            );
          })}
          {bei && (
            <circle cx={bei.sx} cy={bei.sy} r={5}
                    className="kb-wolkenpunkt" style={{ fill: farbeVon.get(String(bei.id)) ?? "var(--kb-text)" }} />
          )}
        </svg>

        {bei && (
          <div className={`kb-tooltip${!schmal && bei.sx > B.breite / 2 ? " kb-tooltip--links" : ""}`}>
            <div className="kb-tooltip-tag">{bei.name}, {tagText(bei.tag)}</div>
            <Zeile name="Punkte" wert={bei.punkte.toLocaleString("de-DE")} />
            <Zeile name="Gesamtwert" wert={euro(bei.gesamt)} />
          </div>
        )}
      </div>

      <div className="kb-legende-band">
        {manager.map((m) => {
          const an = gewaehlt.has(String(m.id));
          const farbe = farbeVon.get(String(m.id));
          const hatDaten = Boolean(pfade[String(m.id)]?.length);
          return (
            <button
              key={m.id}
              type="button"
              className={`kb-legendenchip${an ? " kb-legendenchip--an" : ""}`}
              onClick={() => umschalten(String(m.id))}
              disabled={!hatDaten}
              title={hatDaten ? undefined : "Kein Tag mit Punkten und Gesamtwert gespeichert"}
            >
              <span className="kb-punktfarbe" style={{ background: an && farbe ? farbe : "var(--kb-rand-stark)" }} />
              {m.name}
            </button>
          );
        })}
      </div>
      {gewaehlt.size >= MAX_FARBIG && (
        <p className="kb-info" style={{ marginTop: 8 }}>
          Mehr als {MAX_FARBIG} Linien lassen sich farblich nicht mehr sicher auseinanderhalten —
          erst eine abwählen.
        </p>
      )}
      <p className="kb-legende">
        Ein Punkt je Tag, an dem Punkte und Gesamtwert zugleich bekannt sind. Fehlt ein Tag, wird
        er übersprungen, nicht geschätzt.
      </p>
    </>
  );
}

function Zeile({ name, wert }) {
  return (
    <div className="kb-tooltip-zeile">
      <span className="kb-tooltip-name">{name}</span>
      <span className="kb-tooltip-wert">{wert}</span>
    </div>
  );
}

const SPALTEN = [
  { key: "name", label: "Manager" },
  { key: "punkte", label: "Punkte" },
  { key: "gesamt", label: "Gesamtwert" },
  { key: "mioJePunkt", label: "€ je Pkt" },
  { key: "abstand", label: "zur Geraden" },
];

function Tabelle({ zeilen, trend, meineId }) {
  const [sortKey, setSortKey] = useState("punkte");
  const [absteigend, setAbsteigend] = useState(true);

  const sortiert = useMemo(() => {
    const r = absteigend ? -1 : 1;
    return [...zeilen].sort((a, b) => {
      if (sortKey === "name") return r * String(a.name).localeCompare(String(b.name), "de");
      const va = a[sortKey];
      const vb = b[sortKey];
      // Ohne Wert (verborgen, keine Punkte, keine Gerade) immer ans Ende —
      // in beide Richtungen. Als 0 gelesen verrieten die Nachbarn die
      // Größenordnung.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return r * (va - vb);
    });
  }, [zeilen, sortKey, absteigend]);

  function klick(key) {
    if (key === sortKey) setAbsteigend(!absteigend);
    else { setSortKey(key); setAbsteigend(key !== "name"); }
  }
  const pfeil = (key) => (key === sortKey ? (absteigend ? " ▼" : " ▲") : "");

  return (
    <>
    <div className="kb-tabellenrahmen">
      <table className="kb-tabelle kb-tabelle--schmal">
        <thead>
          <tr>
            {SPALTEN.map((s, i) => (
              <th
                key={s.key}
                scope="col"
                tabIndex={0}
                aria-sort={s.key === sortKey ? (absteigend ? "descending" : "ascending") : undefined}
                className={`${i === 0 ? "kb-namensspalte" : ""}${s.key === sortKey ? " kb-aktiv" : ""}`}
                onClick={() => klick(s.key)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && klick(s.key)}
              >
                {s.label}{pfeil(s.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortiert.map((z, i) => (
            <tr key={z.id}
                className={`${i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}${String(z.id) === String(meineId) ? " kb-zeile--ich" : ""}`}>
              <td className="kb-namensspalte">{z.name}</td>
              <td>{z.punkte.toLocaleString("de-DE")}</td>
              <td>{z.geheim ? <Schloss wer={z.name} /> : z.gesamt == null ? "–" : euroKurz(z.gesamt)}</td>
              <td>{z.geheim ? <Schloss wer={z.name} /> : z.mioJePunkt == null ? "–" : euroKurz(z.mioJePunkt)}</td>
              <td>{z.geheim ? <Schloss wer={z.name} /> : z.abstand == null ? "–" : vorzeichen(z.abstand)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {!trend && (
      <p className="kb-legende">„zur Geraden“ braucht mindestens drei Manager mit unterschiedlich vielen Punkten.</p>
    )}
    </>
  );
}
