"use client";
import { useState, useMemo } from "react";
import { euro, euroKurz } from "@/lib/format";

const SPALTEN = [
  { key: "name", label: "Spieler", text: true },
  { key: "position", label: "Pos.", text: true },
  { key: "marktwert", label: "Marktwert" },
];

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
      setAbsteigend(key === "marktwert");
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
              {zeilen.map((s, i) => (
                <tr key={s.id} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                  <td className="kb-namensspalte">{s.name}</td>
                  <td>{s.position ?? "–"}</td>
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
