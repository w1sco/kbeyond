"use client";
import { useState, useMemo } from "react";
import { euro, euroKurz, prozent } from "@/lib/format";

// Kader zum Durchspielen: Spieler anklicken heißt "verkaufen", und oben
// steht sofort, was das mit Kontostand und Max-Gebot macht.
//
// Gerechnet wird mit dem Marktwert. Beim Verkauf an Kickbase ist das der
// tatsächliche Erlös; verkauft man an einen Mitspieler, kann dessen Gebot
// darüber liegen — dann ist die Rechnung hier die vorsichtige Variante.
export default function Verkaufsrechner({ kader, konto, teamwert, boni = null }) {
  const [gewaehlt, setGewaehlt] = useState(() => new Set());
  // Bis zum Anpfiff kommen noch Login-Gutschriften. Die sind sicher und
  // deshalb vorbelegt – wer nur mit dem Ist-Stand planen will, hakt aus.
  const [boniAn, setBoniAn] = useState(true);
  const [sortKey, setSortKey] = useState("marktwert");
  const [absteigend, setAbsteigend] = useState(true);

  const zeilen = useMemo(() => {
    const kopie = [...kader];
    kopie.sort((a, b) => {
      if (sortKey === "name" || sortKey === "position") {
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        return absteigend ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      return absteigend
        ? Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0)
        : Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0);
    });
    return kopie;
  }, [kader, sortKey, absteigend]);

  const erloes = useMemo(
    () => kader.filter((s) => gewaehlt.has(s.id)).reduce((s, x) => s + Number(x.marktwert ?? 0), 0),
    [kader, gewaehlt]
  );

  const zusatz = boniAn && boni ? boni.betrag : 0;
  // Basis ist der Kontostand, den der Manager am Spieltag tatsächlich hat.
  const basis = konto + zusatz;
  const neuesKonto = basis + erloes;
  const neuerTeamwert = Math.max(0, teamwert - erloes);
  const neuesLimit = Math.floor(neuerTeamwert / 3);
  const neuesMaxGebot = neuesKonto + neuesLimit;
  const neuesGesamt = neuesKonto + neuerTeamwert;

  // Was fehlt noch bis zur schwarzen Null?
  const fehlt = basis < 0 ? -basis : 0;
  const geschafft = basis < 0 && neuesKonto >= 0;

  function umschalten(id) {
    setGewaehlt((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }

  // Kleinstmögliche Auswahl, die das Konto ins Plus bringt: teuerste zuerst,
  // damit möglichst wenige Spieler den Kader verlassen.
  function vorschlag() {
    if (basis >= 0) return;
    const nachWert = [...kader].sort((a, b) => Number(b.marktwert ?? 0) - Number(a.marktwert ?? 0));
    const neu = new Set();
    let summe = 0;
    for (const s of nachWert) {
      if (basis + summe >= 0) break;
      neu.add(s.id);
      summe += Number(s.marktwert ?? 0);
    }
    setGewaehlt(neu);
  }

  function klick(key) {
    if (key === sortKey) setAbsteigend(!absteigend);
    else {
      setSortKey(key);
      setAbsteigend(key !== "name" && key !== "position");
    }
  }

  const pfeil = (key) => (key === sortKey ? (absteigend ? " ▼" : " ▲") : "");

  // sek = weicht auf schmalen Displays. Der Kaufpreis lässt sich aus
  // Marktwert und Gewinn herleiten, die Punkte sind für die Verkaufsfrage
  // ohnehin nebensächlich — sonst müsste man die Tabelle seitlich schieben.
  const SPALTEN = [
    { key: "position", label: "Pos." },
    { key: "marktwert", label: "Marktwert" },
    { key: "kaufpreis", label: "Kaufpreis", sek: true },
    { key: "gewinn", label: "Gewinn" },
    { key: "punkte", label: "Punkte", sek: true },
  ];

  return (
    <>
      <div className={`kb-rechner${geschafft ? " kb-rechner--gut" : ""}`}>
        {boni && boni.betrag > 0 && (
          <label className="kb-ankreuz">
            <input type="checkbox" checked={boniAn} onChange={(e) => setBoniAn(e.target.checked)} />
            <span>
              Login-Boni bis {boni.wahl.label} mitrechnen
              <span className="kb-leise"> ({euro(boni.betrag)} in {boni.naechte} {boni.naechte === 1 ? "Nacht" : "Nächten"})</span>
            </span>
          </label>
        )}

        <div className="kb-kennzahlen">
          <div>
            <span className="kb-label">Verkauf von {gewaehlt.size} Spieler{gewaehlt.size === 1 ? "" : "n"}</span>
            <strong>{euro(erloes)}</strong>
          </div>
          {boni && boni.betrag > 0 && (
            <div>
              <span className="kb-label">Login-Boni bis {boni.wahl.label}</span>
              <strong className={zusatz > 0 ? "kb-plus" : "kb-gedaempft"}>
                {zusatz > 0 ? "+" : ""}{euro(zusatz)}
              </strong>
              <span className="kb-leise"> {boni.naechte} {boni.naechte === 1 ? "Nacht" : "Nächte"}</span>
            </div>
          )}
          <div>
            <span className="kb-label">Kontostand danach</span>
            <strong className={neuesKonto < 0 ? "kb-minus" : "kb-plus"}>{euro(neuesKonto)}</strong>
          </div>
          <div>
            <span className="kb-label">Max-Gebot danach</span>
            {euro(neuesMaxGebot)}
          </div>
          <div>
            <span className="kb-label">Teamwert danach</span>
            {euro(neuerTeamwert)}
          </div>
          <div>
            <span className="kb-label">Gesamtwert danach</span>
            {euro(neuesGesamt)}
            <span className="kb-leise">
              {" "}{neuesGesamt > 0 ? prozent(neuesKonto / neuesGesamt) + " flüssig" : ""}
            </span>
          </div>
        </div>

        <div className="kb-rechner-fuss">
          {konto < 0 && !geschafft && (
            <span>Noch <strong className="kb-minus">{euro(fehlt - erloes)}</strong> bis zur Null.</span>
          )}
          {geschafft && <span className="kb-plus"><strong>Aus dem Minus.</strong> Der Rest ist Puffer.</span>}
          {konto >= 0 && <span>Kein Minus — das hier ist reine Planung.</span>}

          <span className="kb-rechner-knoepfe">
            {konto < 0 && (
              <button className="kb-btn" onClick={vorschlag}>Vorschlag: so wenig wie möglich</button>
            )}
            {gewaehlt.size > 0 && (
              <button className="kb-btn" onClick={() => setGewaehlt(new Set())}>Auswahl leeren</button>
            )}
          </span>
        </div>
      </div>

      <div className="kb-tabellenrahmen">
        <table className="kb-tabelle kb-tabelle--schmal">
          <thead>
            <tr>
              <th
                className="kb-namensspalte"
                scope="col"
                tabIndex={0}
                onClick={() => klick("name")}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && klick("name")}
              >
                Spieler{pfeil("name")}
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
                  {s.label}{pfeil(s.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zeilen.map((s, i) => {
              const aktiv = gewaehlt.has(s.id);
              const gewinn = s.kaufpreis == null ? null : Number(s.marktwert ?? 0) - Number(s.kaufpreis);
              return (
                <tr
                  key={s.id}
                  className={`kb-klickzeile ${aktiv ? "kb-zeile--gewaehlt" : i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}`}
                  onClick={() => umschalten(s.id)}
                >
                  <td className="kb-namensspalte">
                    <input
                      type="checkbox"
                      checked={aktiv}
                      onChange={() => umschalten(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${s.name} verkaufen`}
                    />
                    {" "}<span className="kb-spielername">{s.name}</span>
                  </td>
                  <td>{s.position ?? "–"}</td>
                  <td>
                    <span className="kb-voll">{euro(s.marktwert)}</span>
                    <span className="kb-kurz">{euroKurz(s.marktwert)}</span>
                  </td>
                  <td className="kb-sek">{s.kaufpreis == null ? <span className="kb-gedaempft">–</span> : (
                    <>
                      <span className="kb-voll">{euro(s.kaufpreis)}</span>
                      <span className="kb-kurz">{euroKurz(s.kaufpreis)}</span>
                    </>
                  )}</td>
                  <td className={gewinn != null && gewinn < 0 ? "kb-minus" : undefined}>
                    {gewinn == null ? <span className="kb-gedaempft">–</span> : (
                      <>
                        <span className="kb-voll">{euro(gewinn)}</span>
                        <span className="kb-kurz">{euroKurz(gewinn)}</span>
                      </>
                    )}
                  </td>
                  <td className="kb-sek">{s.punkte ?? "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
