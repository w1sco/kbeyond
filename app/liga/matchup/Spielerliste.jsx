"use client";
import { useState, useMemo } from "react";
import { euro, euroKurz, zeitpunkt } from "@/lib/format";
import { prognostiziere, vorAnpfiff } from "@/lib/rhythmus";
import { ELF_GRUPPEN, OHNE_NIE } from "@/lib/startelf";
import { preisJePunkt, MIN_SPIELE, VORSCHAU } from "@/lib/matchup";
import Startelf from "../../_ui/Startelf";
import { Prognose, VorAnpfiff } from "../../_ui/Marktprognose";
import { useZyklus } from "../../_ui/zyklus";

// Das Spielerranking: Was holt jeder einzelne Spieler voraussichtlich im
// nächsten Spiel, in den nächsten 3 und 5 — und was kostet ein Punkt davon?
//
// Gerechnet wird auf dem Server (spielerErwartung() in lib/matchup.js).
// Hier wird nur sortiert und gefiltert, damit ein Klick keine Seite lädt.

const zahl = (n) => (n == null ? "–" : n.toLocaleString("de-DE", { maximumFractionDigits: 0 }));
const schnittText = (n) => (n == null ? "–" : n.toLocaleString("de-DE", { maximumFractionDigits: 1 }));

// Preis je Punkt in Mio — so gefragt. Unter einer Mio mit drei Stellen,
// sonst stünde bei jedem „0 Mio“.
function mio(n) {
  if (n == null) return "–";
  const m = n / 1_000_000;
  return `${m.toLocaleString("de-DE", { maximumFractionDigits: m < 1 ? 3 : 2 })} Mio`;
}

const MARKT = [
  { schluessel: "alle", label: "alle Spieler" },
  { schluessel: "frei", label: "nur freie", titel: "Spieler, die in keinem Kader der Liga stehen" },
  { schluessel: "bald", label: "✓ ~ vor Anpfiff am Markt",
    titel: "Steht jetzt am Markt oder kommt voraussichtlich hin — und das Angebot läuft vor dem nächsten Anpfiff aus" },
];
const kommtVorAnpfiff = (s) => s.anpfiff?.lage === "sicher" || s.anpfiff?.lage === "vielleicht";

// Was aus einer Erwartung über h Partien in der Zelle steht.
function Erwartung({ e, stark = false }) {
  if (!e) return <span className="kb-gedaempft">–</span>;
  if (e.summe == null) {
    if (e.partien === 0) return <span className="kb-gedaempft" title="Keine Partie mehr">–</span>;
    if (e.bekannt < e.partien) {
      return <span className="kb-leise" title="Nicht jeder dieser Gegner ist bekannt">{e.bekannt} von {e.partien}</span>;
    }
    return <span className="kb-gedaempft">–</span>;
  }
  return (
    <>
      {stark ? <strong>{zahl(e.summe)}</strong> : zahl(e.summe)}
      {e.nur && <span className="kb-leise"> nur {e.partien}</span>}
    </>
  );
}

export default function Spielerliste({ spieler, leagueId, jetzt, anpfiff = null, anpfiffQuelle = null, vor = 3 }) {
  const [sortKey, setSortKey] = useState(`e${vor}`);
  const [absteigend, setAbsteigend] = useState(true);
  const [elfWahl, setElfWahl] = useState(() => new Set());
  const [markt, setMarkt] = useState("alle");
  // Unter MIN_SPIELE Einsätzen ist ein Schnitt ein Zufall: Wer einmal 150
  // geholt hat, stünde sonst ganz oben. Vorgabe deshalb: ausblenden.
  const [nurBelegt, setNurBelegt] = useState(true);
  const [suche, setSuche] = useState("");

  // Der Rhythmus ist derselbe wie auf der Marktseite — dort steht der Regler.
  const [zyklus] = useZyklus(leagueId);

  // `jetzt` kommt vom Server: ein Date.now() beim Rendern liefe beim
  // Hydrieren auseinander.
  const mitMarkt = useMemo(() => spieler.map((s) => {
    const prognose = s.rueckkehr ? prognostiziere({ ...s.rueckkehr, jetzt, zyklusTage: zyklus }) : null;
    return { ...s, prognose, anpfiff: vorAnpfiff(prognose, anpfiff, { jetzt }) };
  }), [spieler, jetzt, zyklus, anpfiff]);

  const passtElf = (s) => elfWahl.size === 0 ||
    ELF_GRUPPEN.some((g) => elfWahl.has(g.schluessel) && g.passt(s.startelf ?? null));
  const passtMarkt = (s, m = markt) =>
    m === "alle" || (m === "frei" ? s.frei : s.frei && kommtVorAnpfiff(s));
  const passtBelegt = (s) => !nurBelegt || s.einsaetze >= MIN_SPIELE;

  // Die Zahlen auf den Chips zählen innerhalb der übrigen Filter — sonst
  // stünde „40 spielen sicher“ da und die Liste zeigte fünf.
  const zaehler = useMemo(() => {
    const z = new Map();
    const fuerElf = mitMarkt.filter((s) => passtBelegt(s) && passtMarkt(s));
    z.set("alle", fuerElf.length);
    z.set("ohneNie", fuerElf.filter((s) => (s.startelf ?? null) !== 5).length);
    for (const g of ELF_GRUPPEN) z.set(g.schluessel, fuerElf.filter((s) => g.passt(s.startelf ?? null)).length);
    const fuerMarkt = mitMarkt.filter((s) => passtBelegt(s) && passtElf(s));
    for (const m of MARKT) z.set(`m_${m.schluessel}`, fuerMarkt.filter((s) => passtMarkt(s, m.schluessel)).length);
    return z;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitMarkt, elfWahl, markt, nurBelegt]);

  const zeilen = useMemo(() => {
    const such = suche.trim().toLowerCase();
    const wert = (s) => {
      if (sortKey.startsWith("e")) return s.erwartung?.[sortKey.slice(1)]?.summe ?? null;
      if (sortKey === "preis") return preisJePunkt(s.marktwert, s.erwartung?.[vor]?.summe);
      return s[sortKey] ?? null;
    };
    const liste = mitMarkt
      .filter((s) => passtBelegt(s) && passtMarkt(s) && passtElf(s))
      .filter((s) => !such || (s.name ?? "").toLowerCase().includes(such));
    liste.sort((a, b) => {
      if (sortKey === "name") {
        return absteigend ? (b.name ?? "").localeCompare(a.name ?? "") : (a.name ?? "").localeCompare(b.name ?? "");
      }
      // Ohne Wert ans Ende, in beide Richtungen — als 0 gelesen stünden sie
      // mitten in der Rangliste.
      const av = wert(a);
      const bv = wert(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return absteigend ? bv - av : av - bv;
    });
    // Rang: Platz in der gezeigten Reihenfolge, gleicher Wert teilt ihn.
    let rang = 0;
    let vorher = null;
    return liste.map((s, i) => {
      const w = sortKey === "name" ? null : wert(s);
      if (w != null && (vorher === null || Math.abs(w - vorher) > 1e-9)) rang = i + 1;
      if (w != null) vorher = w;
      return { ...s, rang: w == null ? null : rang };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitMarkt, sortKey, absteigend, suche, elfWahl, markt, nurBelegt, vor]);

  function klick(key) {
    if (key === sortKey) setAbsteigend(!absteigend);
    else {
      setSortKey(key);
      // Beim Preis je Punkt ist billig das Interessante.
      setAbsteigend(key !== "preis" && key !== "name");
    }
  }
  const pfeil = (key) => (key === sortKey ? (absteigend ? " ▼" : " ▲") : "");

  function gruppeUmschalten(schluessel) {
    setElfWahl((alt) => {
      const neu = new Set(alt);
      if (neu.has(schluessel)) neu.delete(schluessel);
      else neu.add(schluessel);
      return neu.size === ELF_GRUPPEN.length ? new Set() : neu;
    });
  }
  const alleGruppen = elfWahl.size === 0;
  const ohneNie = elfWahl.size === OHNE_NIE.length && OHNE_NIE.every((s) => elfWahl.has(s));

  // Welche Erwartung steht auf dem Handy: die sortierte, sonst die für den
  // Preis gewählte. Die anderen beiden rutschen in die Nebenspalten.
  const aktivH = sortKey.startsWith("e") ? Number(sortKey.slice(1)) : vor;
  const SPALTEN = [
    { key: "schnitt", label: "Ø je Einsatz", sek: true },
    ...VORSCHAU.map((h) => ({ key: `e${h}`, label: h === 1 ? "Nächstes" : `${h} Spiele`, sek: h !== aktivH })),
    { key: "marktwert", label: "Marktwert", sek: true },
    { key: "preis", label: `Mio/Pkt (${vor === 1 ? "1 Sp." : `${vor} Sp.`})` },
  ];

  return (
    <>
      <div className="kb-anpfiffzeile kb-leise">
        {anpfiff
          ? <>Nächster Anpfiff: <strong>{zeitpunkt(anpfiff)}</strong> ({anpfiffQuelle}) · Markt-Rhythmus {zyklus} Tage</>
          : <>Kein Anpfiff bekannt — „vor Anpfiff am Markt“ bleibt offen.</>}
      </div>

      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Startelf-Chance">
        <button type="button" className={`kb-sortchip${alleGruppen ? " kb-sortchip--aktiv" : ""}`}
                aria-pressed={alleGruppen} onClick={() => setElfWahl(new Set())}>
          Alle <span className="kb-chipzahl">{zaehler.get("alle")}</span>
        </button>
        <button type="button" className={`kb-sortchip${ohneNie ? " kb-sortchip--aktiv" : ""}`}
                aria-pressed={ohneNie} title="Alle außer denen, die definitiv nicht spielen"
                onClick={() => setElfWahl(ohneNie ? new Set() : new Set(OHNE_NIE))}>
          ohne ✕ <span className="kb-chipzahl">{zaehler.get("ohneNie")}</span>
        </button>
        {ELF_GRUPPEN.map((g) => {
          const anzahl = zaehler.get(g.schluessel) ?? 0;
          const an = elfWahl.has(g.schluessel);
          return (
            <button key={g.schluessel} type="button" role="checkbox" aria-checked={an}
                    className={`kb-sortchip${an ? " kb-sortchip--aktiv" : ""}`}
                    disabled={anzahl === 0 && !an} onClick={() => gruppeUmschalten(g.schluessel)}>
              {g.label} <span className="kb-chipzahl">{anzahl}</span>
            </button>
          );
        })}
      </div>

      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Transfermarkt" style={{ marginTop: 8 }}>
        {MARKT.map((m) => (
          <button key={m.schluessel} type="button" title={m.titel}
                  className={`kb-sortchip${markt === m.schluessel ? " kb-sortchip--aktiv" : ""}`}
                  aria-pressed={markt === m.schluessel}
                  onClick={() => setMarkt(m.schluessel)}>
            {m.label} <span className="kb-chipzahl">{zaehler.get(`m_${m.schluessel}`)}</span>
          </button>
        ))}
        <button type="button" className={`kb-sortchip${nurBelegt ? " kb-sortchip--aktiv" : ""}`}
                aria-pressed={nurBelegt}
                title={`Wer im Zeitraum seltener gespielt hat, hat einen Schnitt aus Zufall`}
                onClick={() => setNurBelegt(!nurBelegt)}>
          ab {MIN_SPIELE} Einsätzen
        </button>
      </div>

      <input className="kb-eingabe kb-eingabe--voll" style={{ margin: "12px 0" }}
             placeholder="Spieler suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />

      {/* Sortierung fürs Handy: Die Nebenspalten haben dort keine Überschrift. */}
      <div className="kb-sortleiste" role="group" aria-label="Sortierung">
        {SPALTEN.map((s) => (
          <button key={s.key} type="button"
                  className={`kb-sortchip${s.key === sortKey ? " kb-sortchip--aktiv" : ""}`}
                  onClick={() => klick(s.key)}>
            {s.label}{pfeil(s.key)}
          </button>
        ))}
      </div>

      {zeilen.length === 0 ? (
        <p className="kb-info">Kein Spieler passt.</p>
      ) : (
        <div className="kb-tabellenrahmen">
          <table className="kb-tabelle kb-tabelle--schmal">
            <thead>
              <tr>
                <th scope="col" className="kb-rang">#</th>
                <th scope="col" className={`kb-namensspalte${sortKey === "name" ? " kb-aktiv" : ""}`}
                    tabIndex={0} onClick={() => klick("name")}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && klick("name")}>
                  Spieler{pfeil("name")}
                </th>
                {SPALTEN.map((s) => (
                  <th key={s.key} scope="col" tabIndex={0}
                      className={`${s.sek ? "kb-sek" : ""}${s.key === sortKey ? " kb-aktiv" : ""}`}
                      onClick={() => klick(s.key)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && klick(s.key)}>
                    {s.label}{pfeil(s.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zeilen.map((s, i) => {
                const preis = preisJePunkt(s.marktwert, s.erwartung?.[vor]?.summe);
                const n = s.partien?.[0];
                return (
                  <tr key={s.id} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                    <td className="kb-rang">{s.rang ?? "–"}</td>
                    <td className="kb-namensspalte">
                      <span className="kb-spielername">{s.name}</span>
                      <Startelf wert={s.startelf} />
                      {s.meiner && <span className="kb-leise"> · deiner</span>}
                      <span className="kb-matchupmeine">
                        {s.verein ?? "–"} · {s.position}
                        {" · "}Ø {schnittText(s.schnitt)} aus {s.einsaetze}/{s.spieleVerein}
                        {s.wenig && s.einsaetze > 0 && " · wenig Daten"}
                        {n && <> · als Nächstes {n.heim ? "gegen" : "bei"} {n.gegner}</>}
                      </span>
                      {(s.prognose || s.anpfiff) && (
                        <span className="kb-matchupmeine">
                          {s.frei ? "frei · " : "im Kader · "}
                          <Prognose p={s.prognose} zyklus={zyklus} /> <VorAnpfiff a={s.anpfiff} />
                        </span>
                      )}
                    </td>
                    <td className="kb-sek">
                      <span title={`${s.einsaetze} Einsätze in ${s.spieleVerein} Spielen des Vereins · Ligaschnitt ${schnittText(s.liga)}`}>
                        {schnittText(s.schnitt)}
                      </span>
                    </td>
                    {VORSCHAU.map((h) => (
                      <td key={h} className={h === aktivH ? "" : "kb-sek"}
                          title={(s.partien ?? []).slice(0, h)
                            .map((p) => `${p.heim ? "H" : "A"} ${p.gegner}: ${zahl(p.erwartung)}`).join(" · ") || undefined}>
                        <Erwartung e={s.erwartung?.[h]} stark={h === aktivH} />
                      </td>
                    ))}
                    <td className="kb-sek">
                      {s.marktwert == null ? <span className="kb-gedaempft">–</span> : euroKurz(s.marktwert)}
                    </td>
                    <td title={preis == null ? "Ohne positive Erwartung kein Preis" : `${euro(Math.round(preis))} je erwartetem Punkt`}>
                      {mio(preis)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="kb-legende">{zeilen.length} von {spieler.length} Spielern angezeigt</p>
    </>
  );
}
