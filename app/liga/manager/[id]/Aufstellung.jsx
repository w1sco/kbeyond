"use client";
import { useMemo, useState } from "react";
import { euroKurz, POS_ORDNUNG } from "@/lib/format";

const REIHEN = [
  { kurz: "ANG", titel: "Sturm" },
  { kurz: "MF", titel: "Mittelfeld" },
  { kurz: "ABW", titel: "Abwehr" },
  { kurz: "TW", titel: "Tor" },
];

// Elf ist die Obergrenze, nicht die Pflicht: Eine Aufstellung kann auch
// unvollständig sein, und dann soll sie so gezeigt werden, wie sie ist.
const ELF = 11;

// Was ein Vorschlag mindestens abdecken muss, damit die Elf spielbar
// aussieht. Der Rest geht nach Marktwert.
const MINDEST = { TW: 1, ABW: 3, MF: 2, ANG: 1 };

function kurz(p) {
  const s = String(p ?? "");
  return POS_ORDNUNG.includes(s) ? s : null;
}

export default function Aufstellung({ kader }) {
  // Vorbelegt ist die **echte** Aufstellung aus Kickbase, soweit sie beim
  // letzten Kaderabruf erkennbar war. Änderungen daran gelten für den
  // Besuch und werden nicht gespeichert — ein Wiederherstellen aus dem
  // localStorage müsste beim ersten Rendern greifen, dann stünde auf dem
  // Server etwas anderes als im Browser und die Seite hydrierte mit einem
  // Konflikt.
  const echte = useMemo(
    () => kader.filter((s) => s.aufgestellt).map((s) => String(s.id)),
    [kader]
  );
  const [gewaehlt, setGewaehlt] = useState(() => new Set(echte));

  const setzen = (neu) => setGewaehlt(neu);

  // Weicht die Anzeige von der echten Aufstellung ab?
  const geaendert =
    gewaehlt.size !== echte.length || echte.some((id) => !gewaehlt.has(id));

  function umschalten(id) {
    const neu = new Set(gewaehlt);
    if (neu.has(id)) neu.delete(id);
    else if (neu.size < ELF) neu.add(id);
    setzen(neu);
  }

  const nachPosition = useMemo(() => {
    const map = new Map(POS_ORDNUNG.map((p) => [p, []]));
    const ohne = [];
    for (const s of kader) {
      const p = kurz(s.position);
      if (p) map.get(p).push(s);
      else ohne.push(s);
    }
    for (const liste of map.values()) {
      liste.sort((a, b) => Number(b.marktwert ?? 0) - Number(a.marktwert ?? 0));
    }
    return { map, ohne };
  }, [kader]);

  const elf = useMemo(() => kader.filter((s) => gewaehlt.has(String(s.id))), [kader, gewaehlt]);

  const aufbau = useMemo(() => {
    const z = { TW: 0, ABW: 0, MF: 0, ANG: 0, ohne: 0 };
    for (const s of elf) {
      const p = kurz(s.position);
      if (p) z[p]++;
      else z.ohne++;
    }
    return z;
  }, [elf]);

  // "4-4-2" – ohne den Torwart, so wie man es sagt.
  const system = [aufbau.ABW, aufbau.MF, aufbau.ANG].join("-");
  const wert = elf.reduce((s, x) => s + Number(x.marktwert ?? 0), 0);
  const punkte = elf.reduce((s, x) => s + Number(x.punkte ?? 0), 0);

  function vorschlag() {
    const neu = new Set();
    // Erst die Mindestbesetzung je Position, dann nach Marktwert auffüllen.
    for (const [p, anzahl] of Object.entries(MINDEST)) {
      for (const s of (nachPosition.map.get(p) ?? []).slice(0, anzahl)) neu.add(String(s.id));
    }
    const rest = [...kader]
      .filter((s) => !neu.has(String(s.id)) && kurz(s.position))
      .sort((a, b) => Number(b.marktwert ?? 0) - Number(a.marktwert ?? 0));
    for (const s of rest) {
      if (neu.size >= ELF) break;
      neu.add(String(s.id));
    }
    setzen(neu);
  }

  return (
    <>
      <div className="kb-newsleiste">
        <button className="kb-btn kb-btn--stark" onClick={vorschlag}>
          Vorschlag: teuerste Elf
        </button>
        {echte.length > 0 && (
          <button className="kb-btn" disabled={!geaendert} onClick={() => setzen(new Set(echte))}>
            Echte Aufstellung
          </button>
        )}
        <button className="kb-btn" disabled={gewaehlt.size === 0} onClick={() => setzen(new Set())}>
          Leeren
        </button>
        <span className="kb-leise">
          {echte.length === 0
            ? "eigene Auswahl"
            : geaendert
              ? "geändert"
              : "wie in Kickbase aufgestellt"}
          {" · "}
          {gewaehlt.size} von {ELF} gewählt
          {gewaehlt.size > 0 ? ` · ${system} · ${euroKurz(wert)}` : ""}
          {gewaehlt.size > 0 && gewaehlt.size < ELF
            ? ` · ${ELF - gewaehlt.size} ${ELF - gewaehlt.size === 1 ? "Platz" : "Plätze"} frei`
            : ""}
          {punkte > 0 ? ` · ${punkte} Punkte` : ""}
        </span>
      </div>

      {/* Der Platz: Sturm oben, Tor unten – so, wie man eine Aufstellung
          liest. Leere Reihen bleiben sichtbar, damit man sieht, was fehlt. */}
      <div className="kb-platz">
        {REIHEN.map((r) => {
          const drauf = elf.filter((s) => kurz(s.position) === r.kurz);
          return (
            <div key={r.kurz} className="kb-platzreihe">
              <span className="kb-platzmarke">{r.titel}</span>
              <div className="kb-platzspieler">
                {drauf.length === 0 ? (
                  <span className="kb-platzleer">niemand aufgestellt</span>
                ) : (
                  drauf.map((s) => (
                    <button
                      key={s.id}
                      className="kb-trikot"
                      onClick={() => umschalten(String(s.id))}
                      title="Aus der Aufstellung nehmen"
                    >
                      <span className="kb-trikotname">{s.name}</span>
                      <span className="kb-trikotwert">{euroKurz(s.marktwert)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {echte.length === 0 && (
        <p className="kb-info">
          Für diesen Manager liegt keine Aufstellung vor. Zwei mögliche Gründe:{" "}
          <strong>„Alles aktualisieren&ldquo; lief noch nicht</strong>, seit es diese
          Funktion gibt — dann holt ein Klick sie nach. Oder Kickbase gibt die
          Aufstellung <strong>fremder</strong> Manager nicht heraus; die Zeile unter dem
          Aktualisieren-Knopf sagt, welcher Fall vorliegt. Bis dahin: Elf selbst wählen
          oder den Vorschlag nehmen.
        </p>
      )}

      {aufbau.ohne > 0 && (
        <p className="kb-info">
          {aufbau.ohne} aufgestellte Spieler haben keine erkennbare Position und stehen
          deshalb in keiner Reihe.
        </p>
      )}

      <div className="kb-kaderwahl">
        {POS_ORDNUNG.map((p) => {
          const liste = nachPosition.map.get(p) ?? [];
          if (liste.length === 0) return null;
          return (
            <div key={p} className="kb-kaderwahlgruppe">
              <span className="kb-label">{REIHEN.find((r) => r.kurz === p)?.titel ?? p}</span>
              <div className="kb-chips">
                {liste.map((s) => {
                  const an = gewaehlt.has(String(s.id));
                  return (
                    <button
                      key={s.id}
                      className={`kb-chip${an ? " kb-chip--an" : ""}`}
                      onClick={() => umschalten(String(s.id))}
                      disabled={!an && gewaehlt.size >= ELF}
                      title={an ? "Aus der Aufstellung nehmen" : "Aufstellen"}
                    >
                      {s.name}
                      <span className="kb-leise"> {euroKurz(s.marktwert)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {nachPosition.ohne.length > 0 && (
          <div className="kb-kaderwahlgruppe">
            <span className="kb-label">ohne Position</span>
            <div className="kb-chips">
              {nachPosition.ohne.map((s) => (
                <button
                  key={s.id}
                  className={`kb-chip${gewaehlt.has(String(s.id)) ? " kb-chip--an" : ""}`}
                  onClick={() => umschalten(String(s.id))}
                  disabled={!gewaehlt.has(String(s.id)) && gewaehlt.size >= ELF}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
