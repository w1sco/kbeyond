"use client";
import { useState, useMemo } from "react";
import { euro } from "@/lib/format";

const SPALTEN = [
  { key: "gesamtwert", label: "Gesamtwert" },
  { key: "maxGebot",   label: "Max-Gebot" },
  { key: "konto",      label: "Liquidität" },
  { key: "teamwert",   label: "Teamwert" },
  { key: "limit",      label: "Limit (⅓)" },
  { key: "strafen",    label: "Strafen" },
  { key: "korrektur",  label: "Korrektur" },
  { key: "punkte",     label: "Punkte" },
];

export default function Tabelle({ konten, meineId, unsicher }) {
  const [sortKey, setSortKey] = useState("gesamtwert");
  const [absteigend, setAbsteigend] = useState(true);

  const sortiert = useMemo(() => {
    const kopie = konten.map((k) => ({ ...k, gesamtwert: k.konto + k.teamwert }));
    kopie.sort((a, b) => {
      if (sortKey === "name") {
        return absteigend ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
      }
      const av = Number(a[sortKey] ?? 0);
      const bv = Number(b[sortKey] ?? 0);
      return absteigend ? bv - av : av - bv;
    });
    return kopie;
  }, [konten, sortKey, absteigend]);

  function klick(key) {
    if (key === sortKey) {
      setAbsteigend(!absteigend);
    } else {
      setSortKey(key);
      setAbsteigend(key !== "name");
    }
  }

  const pfeil = (key) => (key === sortKey ? (absteigend ? " ▼" : " ▲") : "");

  return (
    <div style={S.wrapper}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, ...S.sticky, ...S.stickyHead }} onClick={() => klick("name")}>
              Manager{pfeil("name")}
            </th>
            {SPALTEN.map((s) => (
              <th
                key={s.key}
                style={{ ...S.thR, background: s.key === sortKey ? "#e0e7ff" : "#fff" }}
                onClick={() => klick(s.key)}
              >
                {s.label}{pfeil(s.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortiert.map((k, i) => {
            const binIch = k.id === meineId;
            const bg = binIch ? "#eff6ff" : i % 2 ? "#fafafa" : "#fff";
            return (
              <tr key={k.id}>
                <td style={{ ...S.td, ...S.sticky, background: bg }}>
                  <span style={S.rang}>{i + 1}</span>
                  <strong>{k.name}</strong>
                  {binIch && <span style={S.ok}>exakt</span>}
                  {!binIch && unsicher && <span style={S.circa}>ca.</span>}
                </td>
                <td style={{ ...S.tdR, background: bg }}>
                  <strong>{k.teamwert > 0 ? euro(k.gesamtwert) : "–"}</strong>
                </td>
                <td style={{ ...S.tdR, background: bg }}>
                  {k.teamwert > 0 ? euro(k.maxGebot) : "–"}
                </td>
                <td style={{ ...S.tdR, background: bg, color: k.konto < 0 ? "#dc2626" : "inherit" }}>
                  {!binIch && unsicher && <span style={S.muted}>~ </span>}
                  {euro(k.konto)}
                </td>
                <td style={{ ...S.tdR, background: bg }}>
                  {k.teamwert > 0 ? euro(k.teamwert) : "–"}
                  {k.kaderGroesse > 0 && <span style={S.muted}> ({k.kaderGroesse})</span>}
                </td>
                <td style={{ ...S.tdR, background: bg, color: "#94a3b8" }}>
                  {k.limit > 0 ? euro(k.limit) : "–"}
                </td>
                <td style={{ ...S.tdR, background: bg, color: k.strafen < 0 ? "#dc2626" : "#94a3b8" }}>
                  {k.anzStrafen > 0 ? `${euro(k.strafen)} (${k.anzStrafen})` : "–"}
                </td>
                <td style={{ ...S.tdR, background: bg, color: k.korrektur !== 0 ? "#7c3aed" : "#94a3b8" }}>
                  {k.korrektur !== 0 ? euro(k.korrektur) : "–"}
                </td>
                <td style={{ ...S.tdR, background: bg }}>{k.punkte}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const S = {
  wrapper: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8, WebkitOverflowScrolling: "touch" },
  table: { borderCollapse: "separate", borderSpacing: 0, fontSize: 14, minWidth: 820 },
  th: {
    textAlign: "left", padding: "10px", borderBottom: "2px solid #e2e8f0",
    fontSize: 11, textTransform: "uppercase", color: "#475569",
    whiteSpace: "nowrap", cursor: "pointer", userSelect: "none", background: "#fff",
  },
  thR: {
    textAlign: "right", padding: "10px", borderBottom: "2px solid #e2e8f0",
    fontSize: 11, textTransform: "uppercase", color: "#475569",
    whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
  },
  td: { padding: "10px", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" },
  tdR: { padding: "10px", borderBottom: "1px solid #f1f5f9", textAlign: "right", whiteSpace: "nowrap" },
  sticky: {
    position: "sticky", left: 0, zIndex: 2,
    borderRight: "1px solid #e2e8f0", minWidth: 170,
  },
  stickyHead: { zIndex: 3 },
  rang: { display: "inline-block", width: 22, color: "#94a3b8", fontSize: 12 },
  muted: { color: "#94a3b8", fontSize: 12 },
  ok: { color: "#16a34a", fontSize: 10, marginLeft: 6, textTransform: "uppercase" },
  circa: { color: "#ea580c", fontSize: 10, marginLeft: 6, textTransform: "uppercase" },
};
