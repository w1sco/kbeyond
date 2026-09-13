"use client";
import { useState, useMemo, useSyncExternalStore } from "react";
import { euro, euroKurz, zeitpunkt, POS_ORDNUNG } from "@/lib/format";
import { prognostiziere, ZYKLUS_TAGE, ZYKLUS_BEREICH } from "@/lib/rhythmus";
import Kaufrechner from "../../_ui/Kaufrechner";
import Startelf from "../../_ui/Startelf";

const SPALTEN = [
  { key: "name", label: "Spieler", text: true },
  { key: "position", label: "Pos.", text: true, sek: true },
  { key: "marktwert", label: "Marktwert" },
  { key: "wieder", label: "Wieder am Markt" },
];

// Sortierwert der Prognose: was am ehesten kommt, steht oben.
// Aufsteigend gelesen — deshalb kleine Zahlen für "bald".
function prognoseRang(p) {
  if (!p) return 9e9;
  switch (p.lage) {
    case "aufMarkt":          return -1;              // steht jetzt dort
    case "ueberfaellig":      return 0;               // kann jederzeit kommen
    case "erwartet":          return Math.max(0.01, p.tageHin);
    case "nieDagewesen":      return 500;             // irgendwann in den nächsten Tagen
    default:                  return 1000;            // keine Prognose
  }
}

// ── Der gemerkte Rhythmus, als externer Speicher ───────────────────
//
// Der localStorage ist ein Speicher außerhalb von React, und genau so wird
// er gelesen: über useSyncExternalStore. Das löst zwei Dinge auf einmal —
// auf dem Server gilt die Vorgabe (kein Hydrierungskonflikt, der hier
// schon einmal die Aufstellungsauswahl gekostet hat), und es braucht kein
// setState in einem Effekt, das der Linter zu Recht anmahnt.
const hoerer = new Set();
function abonniere(cb) {
  hoerer.add(cb);
  window.addEventListener("storage", cb);
  return () => { hoerer.delete(cb); window.removeEventListener("storage", cb); };
}
function ladeZyklus(schluessel) {
  try {
    const n = Number(localStorage.getItem(schluessel));
    return n >= ZYKLUS_BEREICH[0] && n <= ZYKLUS_BEREICH[1] ? n : ZYKLUS_TAGE;
  } catch {
    return ZYKLUS_TAGE; // kein Speicher (privater Modus o. ä.) – dann die Vorgabe
  }
}
function merkeZyklus(schluessel, n) {
  try { localStorage.setItem(schluessel, String(n)); } catch { /* dann nur bis zum Neuladen */ }
  for (const cb of hoerer) cb();
}

function Prognose({ p, zyklus }) {
  if (!p) return <span className="kb-gedaempft">–</span>;

  switch (p.lage) {
    case "aufMarkt":
      return <span className="kb-plus"><strong>jetzt am Markt</strong></span>;

    case "ueberfaellig":
      return (
        <span title={`Erwartet war ${zeitpunkt(p.naechster)}`}>
          jederzeit
          <span className="kb-leise"> überfällig</span>
        </span>
      );

    case "erwartet": {
      const tage = Math.round(p.tageHin);
      const text = tage <= 0 ? "heute" : tage === 1 ? "morgen" : `in ${tage} Tagen`;
      const woher = p.durchVerkauf ? "Verkauf" : "Auftritt";
      return (
        <span title={`${woher} am ${zeitpunkt(p.anker)} · alle ${zyklus} Tage`}>
          {text}
          {p.sicherheit !== "gut" && <span className="kb-leise"> ca.</span>}
        </span>
      );
    }

    case "nieDagewesen":
      return <span className="kb-gedaempft">kommt demnächst</span>;

    default:
      return <span className="kb-gedaempft">–</span>;
  }
}

export default function Freieliste({
  spieler, leagueId, jetzt, konto = null, teamwert = 0, ligaAufschlag = null,
  eigenerKader = [], boni = null,
}) {
  const [gewaehlt, setGewaehlt] = useState(() => new Set());

  // ── Der Rhythmus als Regler ──────────────────────────────────────
  //
  // Vorgabe 14 Tage. Wer die Liga anders erlebt, schiebt — die Spalte
  // rechnet sofort neu, weil die Anker je Spieler hier liegen und die
  // Rechnung ohne Datenbank auskommt.
  //
  // Gemerkt wird im Browser, je Liga — siehe oben, wie.
  const schluessel = `kb_zyklus_${leagueId}`;
  const gemerkt = useSyncExternalStore(
    abonniere, () => ladeZyklus(schluessel), () => ZYKLUS_TAGE);
  // Fällt der Speicher aus, hält der Zustand den Wert bis zum Neuladen.
  const [ungespeichert, setUngespeichert] = useState(null);
  const zyklus = ungespeichert ?? gemerkt;
  function zyklusSetzen(n) {
    setUngespeichert(n);
    merkeZyklus(schluessel, n);
  }

  // `jetzt` kommt vom Server: ein Date.now() beim Rendern liefe beim
  // Hydrieren auseinander.
  const mitPrognose = useMemo(
    () => spieler.map((s) => ({
      ...s,
      prognose: s.rueckkehr
        ? prognostiziere({ ...s.rueckkehr, jetzt, zyklusTage: zyklus })
        : null,
    })),
    [spieler, jetzt, zyklus]
  );
  const [sortKey, setSortKey] = useState("marktwert");
  const [absteigend, setAbsteigend] = useState(true);
  const [suche, setSuche] = useState("");
  const [pos, setPos] = useState("alle");

  // Wie viele freie Spieler es je Position gibt. Steht auf den Chips, damit
  // man vor dem Klick sieht, ob sich einer lohnt.
  const jePosition = useMemo(() => {
    const z = new Map();
    for (const s of spieler) z.set(s.position, (z.get(s.position) ?? 0) + 1);
    return z;
  }, [spieler]);

  const zeilen = useMemo(() => {
    const s = suche.trim().toLowerCase();
    let gefiltert = pos === "alle" ? mitPrognose : mitPrognose.filter((x) => x.position === pos);
    if (s) gefiltert = gefiltert.filter((x) => (x.name ?? "").toLowerCase().includes(s));

    const kopie = [...gefiltert];
    kopie.sort((a, b) => {
      if (sortKey === "wieder") {
        const av = prognoseRang(a.prognose);
        const bv = prognoseRang(b.prognose);
        // Bei der Prognose ist "bald" das Interessante, deshalb hier
        // aufsteigend, wenn absteigend gewählt ist.
        return absteigend ? av - bv : bv - av;
      }
      const spalte = SPALTEN.find((x) => x.key === sortKey);
      if (spalte?.text) {
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        return absteigend ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      return absteigend
        ? Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0)
        : Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0);
    });
    return kopie;
  }, [mitPrognose, sortKey, absteigend, suche, pos]);

  function klick(key) {
    if (key === sortKey) setAbsteigend(!absteigend);
    else {
      setSortKey(key);
      setAbsteigend(key === "marktwert" || key === "wieder");
    }
  }

  const pfeil = (key) => (key === sortKey ? (absteigend ? " ▼" : " ▲") : "");

  function umschalten(id) {
    setGewaehlt((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }

  const gewaehlteSpieler = spieler.filter((s) => gewaehlt.has(String(s.id)));

  return (
    <>
      {konto != null && (
        <Kaufrechner
          gewaehlt={gewaehlteSpieler}
          konto={konto}
          teamwert={teamwert}
          ligaAufschlag={ligaAufschlag}
          eigenerKader={eigenerKader}
          boni={boni}
          aufLeeren={() => setGewaehlt(new Set())}
        />
      )}

      <div className="kb-zyklus">
        <label className="kb-aufschlagregler">
          <span className="kb-label">
            Wieder am Markt nach: <strong>{zyklus} {zyklus === 1 ? "Tag" : "Tagen"}</strong>
            {zyklus !== ZYKLUS_TAGE && (
              <button type="button" className="kb-btn kb-btn--klein"
                      onClick={() => zyklusSetzen(ZYKLUS_TAGE)}>
                zurück auf {ZYKLUS_TAGE}
              </button>
            )}
          </span>
          <input type="range" min={ZYKLUS_BEREICH[0]} max={ZYKLUS_BEREICH[1]} step={1}
                 value={zyklus} onChange={(e) => zyklusSetzen(Number(e.target.value))} />
        </label>
      </div>

      {/* Die Position filtert nur die Liste, nicht das Verhältnis darüber:
          „Was kann die Liga bezahlen" ist eine Frage über den ganzen freien
          Markt, nicht über die Stürmer darin. */}
      <div className="kb-sortleiste kb-sortleiste--immer" style={{ marginTop: 12 }}>
        {[["alle", "Alle"], ...POS_ORDNUNG.map((k) => [k, k])].map(([wert, label]) => {
          const anzahl = wert === "alle" ? spieler.length : (jePosition.get(wert) ?? 0);
          return (
            <button
              key={wert}
              type="button"
              className={`kb-sortchip${pos === wert ? " kb-sortchip--aktiv" : ""}`}
              disabled={anzahl === 0}
              onClick={() => setPos(wert)}
            >
              {label} <span className="kb-chipzahl">{anzahl}</span>
            </button>
          );
        })}
      </div>

      <input
        className="kb-eingabe kb-eingabe--voll"
        style={{ margin: "12px 0" }}
        placeholder="Spieler suchen …"
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
      />

      {zeilen.length === 0 ? (
        <p className="kb-info">Kein Spieler passt.</p>
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
              {zeilen.map((s, i) => (
                <tr
                  key={s.id}
                  className={`${konto != null ? "kb-klickzeile " : ""}${
                    gewaehlt.has(String(s.id))
                      ? "kb-zeile--gewaehlt"
                      : i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"
                  }`}
                  onClick={konto != null ? () => umschalten(String(s.id)) : undefined}
                >
                  {konto != null && (
                    <td className="kb-wahlspalte">
                      <input
                        type="checkbox"
                        checked={gewaehlt.has(String(s.id))}
                        onChange={() => umschalten(String(s.id))}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${s.name} einplanen`}
                      />
                    </td>
                  )}
                  <td className="kb-namensspalte">
                    <span className="kb-spielername">{s.name}</span>
                    <Startelf wert={s.startelf} />
                  </td>
                  <td className="kb-sek">{s.position ?? "–"}</td>
                  <td>
                    {s.marktwert == null ? (
                      <span className="kb-gedaempft">unbekannt</span>
                    ) : (
                      <>
                        <span className="kb-voll">{euro(s.marktwert)}</span>
                        <span className="kb-kurz">{euroKurz(s.marktwert)}</span>
                      </>
                    )}
                  </td>
                  <td><Prognose p={s.prognose} zyklus={zyklus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="kb-legende">
        {zeilen.length} von {spieler.length} Spielern angezeigt
        {pos !== "alle" && ` · nur ${pos}`}
      </p>
    </>
  );
}
