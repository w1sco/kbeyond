"use client";
import { Fragment, useState, useMemo } from "react";
import { euro, euroKurz } from "@/lib/format";

// sek = Sekundärspalte: verschwindet auf schmalen Displays in die
// Detailzeile. Sichtbar bleiben Gesamtwert, Max-Gebot und Liquidität –
// die drei Zahlen, mit denen man Manager vergleicht.
const SPALTEN = [
  { key: "gesamtwert", label: "Gesamtwert", kurz: "Gesamt" },
  { key: "maxGebot",   label: "Max-Gebot",  kurz: "Gebot" },
  { key: "konto",      label: "Liquidität", kurz: "Liquid." },
  { key: "teamwert",   label: "Teamwert",   sek: true },
  { key: "limit",      label: "Limit (⅓)",  sek: true },
  { key: "strafen",    label: "Strafen",    sek: true },
  { key: "korrektur",  label: "Korrektur",  sek: true },
  { key: "punkte",     label: "Punkte",     sek: true },
];

// Geldbetrag in zwei Fassungen: lang für den Desktop, kurz fürs Handy.
// Welche sichtbar ist, entscheidet allein CSS – kein zweiter Renderpfad.
function Geld({ wert }) {
  return (
    <>
      <span className="kb-voll">{euro(wert)}</span>
      <span className="kb-kurz">{euroKurz(wert)}</span>
    </>
  );
}

export default function Tabelle({ konten, meineId, unsicher }) {
  const [sortKey, setSortKey] = useState("gesamtwert");
  const [absteigend, setAbsteigend] = useState(true);
  const [offen, setOffen] = useState(() => new Set());

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

  function umschalten(id) {
    setOffen((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }

  const pfeil = (key) => (key === sortKey ? (absteigend ? " ▼" : " ▲") : "");

  // Ein Wert, eine Darstellung – egal ob in der Tabellenzelle oder
  // aufgeklappt in der Detailzeile.
  function wert(k, key) {
    switch (key) {
      case "gesamtwert":
        return k.teamwert > 0 ? <strong><Geld wert={k.gesamtwert} /></strong> : "–";
      case "maxGebot":
        return k.teamwert > 0 ? <Geld wert={k.maxGebot} /> : "–";
      case "konto":
        return (
          <span className={k.konto < 0 ? "kb-minus" : undefined}>
            {unsicher && k.id !== meineId && <span className="kb-gedaempft">~ </span>}
            <Geld wert={k.konto} />
          </span>
        );
      case "teamwert":
        return k.teamwert > 0 ? (
          <>
            <Geld wert={k.teamwert} />
            {k.kaderGroesse > 0 && <span className="kb-leise"> ({k.kaderGroesse})</span>}
          </>
        ) : "–";
      case "limit":
        return k.limit > 0 ? <span className="kb-gedaempft"><Geld wert={k.limit} /></span> : "–";
      case "strafen":
        return k.anzStrafen > 0 ? (
          <span className={k.strafen < 0 ? "kb-minus" : undefined}>
            <Geld wert={k.strafen} /> ({k.anzStrafen})
          </span>
        ) : <span className="kb-gedaempft">–</span>;
      case "korrektur":
        return k.korrektur !== 0
          ? <span className="kb-korrwert"><Geld wert={k.korrektur} /></span>
          : <span className="kb-gedaempft">–</span>;
      case "punkte":
        return k.punkte;
      default:
        return null;
    }
  }

  return (
    <>
      {/* Sortierung fürs Handy: die ausgeblendeten Spalten haben dort
          keine anklickbare Überschrift mehr. */}
      <div className="kb-sortleiste" role="group" aria-label="Sortierung">
        <button
          className={`kb-sortchip${sortKey === "name" ? " kb-sortchip--aktiv" : ""}`}
          onClick={() => klick("name")}
        >
          Name{pfeil("name")}
        </button>
        {SPALTEN.map((s) => (
          <button
            key={s.key}
            className={`kb-sortchip${s.key === sortKey ? " kb-sortchip--aktiv" : ""}`}
            onClick={() => klick(s.key)}
          >
            {s.label}{pfeil(s.key)}
          </button>
        ))}
      </div>

      <div className="kb-tabellenrahmen">
        <table className="kb-tabelle">
          <thead>
            <tr>
              <th
                className="kb-namensspalte"
                scope="col"
                tabIndex={0}
                onClick={() => klick("name")}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && klick("name")}
              >
                Manager{pfeil("name")}
              </th>
              {SPALTEN.map((s) => (
                <th
                  key={s.key}
                  scope="col"
                  tabIndex={0}
                  className={`${s.sek ? "kb-sek" : ""}${s.key === sortKey ? " kb-aktiv" : ""}`}
                  onClick={() => klick(s.key)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && klick(s.key)}
                >
                  <span className="kb-voll">{s.label}</span>
                  <span className="kb-kurz">{s.kurz ?? s.label}</span>
                  {pfeil(s.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortiert.map((k, i) => {
              const binIch = k.id === meineId;
              const zeilenKlasse = binIch
                ? "kb-zeile--ich"
                : i % 2
                  ? "kb-zeile--grau"
                  : "kb-zeile--weiss";
              const aufgeklappt = offen.has(k.id);

              return (
                <Fragment key={k.id}>
                  <tr className={zeilenKlasse}>
                    <td className="kb-namensspalte">
                      <button
                        className="kb-aufklapp"
                        onClick={() => umschalten(k.id)}
                        aria-expanded={aufgeklappt}
                        aria-label={`Details für ${k.name}`}
                      >
                        {aufgeklappt ? "−" : "+"}
                      </button>
                      <span className="kb-rang">{i + 1}</span>
                      <strong className="kb-name">{k.name}</strong>
                      {binIch && <span className="kb-marke kb-marke--exakt">exakt</span>}
                      {!binIch && unsicher && <span className="kb-marke kb-marke--circa">ca.</span>}
                    </td>
                    {SPALTEN.map((s) => (
                      <td key={s.key} className={s.sek ? "kb-sek" : undefined}>
                        {wert(k, s.key)}
                      </td>
                    ))}
                  </tr>

                  {aufgeklappt && (
                    <tr className={`kb-detailzeile ${zeilenKlasse}`}>
                      <td colSpan={SPALTEN.length + 1}>
                        <div className="kb-detailgitter">
                          {SPALTEN.map((s) => (
                            <div key={s.key}>
                              <span className="kb-label">{s.label}</span>
                              {wert(k, s.key)}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
