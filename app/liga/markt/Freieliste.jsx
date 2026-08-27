"use client";
import { useState, useMemo } from "react";
import { euro, euroKurz, zeitpunkt } from "@/lib/format";

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
    default:                  return 1000;            // Rhythmus unbekannt
  }
}

function Prognose({ p }) {
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
      return (
        <span title={`Letzter Auftritt ${zeitpunkt(p.letzter)}`}>
          {text}
          {p.sicherheit !== "gut" && <span className="kb-leise"> ca.</span>}
        </span>
      );
    }

    case "nieDagewesen":
      return <span className="kb-gedaempft">kommt demnächst</span>;

    default:
      return <span className="kb-gedaempft">Rhythmus unbekannt</span>;
  }
}

export default function Freieliste({ spieler }) {
  const [sortKey, setSortKey] = useState("marktwert");
  const [absteigend, setAbsteigend] = useState(true);
  const [suche, setSuche] = useState("");

  const zeilen = useMemo(() => {
    const s = suche.trim().toLowerCase();
    const gefiltert = s
      ? spieler.filter((x) => (x.name ?? "").toLowerCase().includes(s))
      : spieler;

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
  }, [spieler, sortKey, absteigend, suche]);

  function klick(key) {
    if (key === sortKey) setAbsteigend(!absteigend);
    else {
      setSortKey(key);
      setAbsteigend(key === "marktwert" || key === "wieder");
    }
  }

  const pfeil = (key) => (key === sortKey ? (absteigend ? " ▼" : " ▲") : "");

  return (
    <>
      <input
        className="kb-eingabe kb-eingabe--voll"
        style={{ margin: "4px 0 12px" }}
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
                <tr key={s.id} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                  <td className="kb-namensspalte">
                    <span className="kb-spielername">{s.name}</span>
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
                  <td><Prognose p={s.prognose} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="kb-legende">{zeilen.length} Spieler angezeigt</p>
    </>
  );
}
