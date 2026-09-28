"use client";
import { useState, useMemo, useSyncExternalStore } from "react";
import { euro, euroKurz, zeitpunkt, POS_ORDNUNG } from "@/lib/format";
import { prognostiziere, vorAnpfiff, ZYKLUS_TAGE, ZYKLUS_BEREICH } from "@/lib/rhythmus";
import Kaufrechner from "../../_ui/Kaufrechner";
import Startelf from "../../_ui/Startelf";

const SPALTEN = [
  { key: "name", label: "Spieler", text: true },
  { key: "position", label: "Pos.", text: true, sek: true },
  { key: "marktwert", label: "Marktwert" },
  // Auf dem Handy ausgeblendet: Dort stehen beide Werte unter dem
  // Marktwert, sortiert wird über die Chipleiste.
  { key: "mw24", label: "24 h", sek: true, bewegung: true },
  { key: "mw7", label: "7 Tage", sek: true, bewegung: true },
  { key: "wieder", label: "Wieder am Markt" },
];

// Eine Marktwert-Bewegung: grün hoch, rot runter, ±0 gedämpft. Keine
// Ablesung von damals heißt „–“, nicht 0 — null ist keine Aussage.
function Bewegung({ wert, kurz = false }) {
  if (wert == null) return <span className="kb-gedaempft">–</span>;
  if (wert === 0) return <span className="kb-gedaempft">±0</span>;
  return (
    <span className={wert < 0 ? "kb-minus" : "kb-plus"}>
      {wert > 0 ? "+" : ""}{kurz ? euroKurz(wert) : euro(wert)}
    </span>
  );
}

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

// ── Filter nach Startelf-Chance ─────────────────────────────────────
//
// Fünf Gruppen, **überschneidungsfrei** — nur so ergibt eine Mehrfachauswahl
// einen Sinn. „Spielt sicher" und „spielt evtl." zusammen sind dann genau
// die, die man aufstellen kann.
//
// **Gewählt heißt: nur diese.** Die erste Fassung startete mit allen
// Gruppen an, und ein Tipp auf „spielt sicher" schaltete genau diese
// Gruppe AUS — wer die Sicheren sehen wollte, bekam alle anderen. Jetzt ist
// die Auswahl anfangs leer (= alle), und jeder Tipp nimmt eine Gruppe dazu
// oder wieder weg, wie bei jedem Filter.
//
// Wer keine Angabe hat, ist eine eigene Gruppe: weder sicher noch
// vielleicht, aber auch nicht „spielt nicht". Eine fehlende Angabe ist
// keine Aussage.
const ELF_GRUPPEN = [
  { schluessel: "sicher", label: "★ ✔ spielt sicher", passt: (st) => st === 1 || st === 2 },
  { schluessel: "evtl",   label: "? spielt evtl.",    passt: (st) => st === 3 },
  { schluessel: "kaum",   label: "! eher nicht",      passt: (st) => st === 4 },
  { schluessel: "nie",    label: "✕ spielt nicht",    passt: (st) => st === 5 },
  { schluessel: "offen",  label: "ohne Angabe",       passt: (st) => st == null },
];
// Die Abkürzung für „alle raus, die definitiv nicht spielen".
const OHNE_NIE = ELF_GRUPPEN.map((g) => g.schluessel).filter((s) => s !== "nie");

// Das Zeichen zur Frage „läuft er noch vor dem Anpfiff aus?"
function VorAnpfiff({ a }) {
  if (!a || !a.lage) return null;
  const wann = a.ablauf ? ` · Ablauf ${zeitpunkt(a.ablauf)}` : "";
  const form = {
    sicher:     ["kb-anpfiff kb-anpfiff--ja",    "✓", "vor Anpfiff",  `Läuft vor dem Anpfiff aus${wann}`],
    vielleicht: ["kb-anpfiff kb-anpfiff--knapp", "~", "knapp",        `Könnte noch vor dem Anpfiff auslaufen${wann}`],
    nein:       ["kb-anpfiff kb-anpfiff--nein",  "✕", "erst danach",  `Läuft erst nach dem Anpfiff aus${wann}`],
  }[a.lage];
  if (!form) return null;
  const [klasse, zeichen, text, titel] = form;
  return (
    <span className={klasse} title={titel}>
      <span aria-hidden="true">{zeichen}</span> {text}
    </span>
  );
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
  spieler, leagueId, jetzt, anpfiff = null, anpfiffQuelle = null,
  konto = null, teamwert = 0, ligaAufschlag = null, eigenerKader = [], boni = null,
}) {
  const [gewaehlt, setGewaehlt] = useState(() => new Set());
  // Welche Gruppen gezeigt werden. Leer heißt: keine Einschränkung.
  const [elfWahl, setElfWahl] = useState(() => new Set());
  function gruppeUmschalten(schluessel) {
    setElfWahl((alt) => {
      const neu = new Set(alt);
      if (neu.has(schluessel)) neu.delete(schluessel);
      else neu.add(schluessel);
      // Alle fünf gewählt ist dasselbe wie keine Einschränkung.
      return neu.size === ELF_GRUPPEN.length ? new Set() : neu;
    });
  }
  const alleGruppen = elfWahl.size === 0;
  const ohneNie = elfWahl.size === OHNE_NIE.length && OHNE_NIE.every((s) => elfWahl.has(s));

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
    () => spieler.map((s) => {
      const prognose = s.rueckkehr
        ? prognostiziere({ ...s.rueckkehr, jetzt, zyklusTage: zyklus })
        : null;
      return { ...s, prognose, anpfiff: vorAnpfiff(prognose, anpfiff, { jetzt }) };
    }),
    [spieler, jetzt, zyklus, anpfiff]
  );

  // Wie viele je Gruppe — steht auf den Chips, damit man vor dem Klick
  // sieht, ob sich einer lohnt. Dieselbe Regel wie bei den Positionen.
  const [sortKey, setSortKey] = useState("marktwert");
  const [absteigend, setAbsteigend] = useState(true);
  const [suche, setSuche] = useState("");
  const [pos, setPos] = useState("alle");

  // Gezählt wird innerhalb der gewählten Position — sonst stünde auf dem
  // Chip „12 spielen sicher" und die Liste zeigte drei Torhüter.
  const jeGruppe = useMemo(() => {
    const basis = pos === "alle" ? spieler : spieler.filter((x) => x.position === pos);
    const z = new Map([["alle", basis.length]]);
    for (const g of ELF_GRUPPEN) {
      z.set(g.schluessel, basis.filter((x) => g.passt(x.startelf ?? null)).length);
    }
    z.set("ohneNie", basis.filter((x) => (x.startelf ?? null) !== 5).length);
    return z;
  }, [spieler, pos]);

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
    if (!alleGruppen) {
      const aktiv = ELF_GRUPPEN.filter((g) => elfWahl.has(g.schluessel));
      gefiltert = gefiltert.filter((x) => aktiv.some((g) => g.passt(x.startelf ?? null)));
    }
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
      if (spalte?.bewegung) {
        // Ohne Ablesung von damals ans Ende, in beide Richtungen — als 0
        // gelesen stünden sie mitten zwischen Gewinnern und Verlierern.
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return absteigend ? bv - av : av - bv;
      }
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
  }, [mitPrognose, sortKey, absteigend, suche, pos, elfWahl, alleGruppen]);

  function klick(key) {
    if (key === sortKey) setAbsteigend(!absteigend);
    else {
      setSortKey(key);
      setAbsteigend(key === "marktwert" || key === "wieder" || key === "mw24" || key === "mw7");
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

      {/* Läuft er noch vor dem Anpfiff aus? Die Zeile sagt, gegen welchen
          Anpfiff gerechnet wird — und woher der stammt. */}
      <div className="kb-anpfiffzeile kb-leise">
        {anpfiff
          ? <>Nächster Anpfiff: <strong>{zeitpunkt(anpfiff)}</strong> ({anpfiffQuelle})</>
          : <>Kein Anpfiff bekannt — die Frage „vor dem Anpfiff?&ldquo; bleibt offen.</>}
      </div>

      {/* Filter nach Startelf-Chance: Mehrfachauswahl. Gewählt = nur
          diese; nichts gewählt = alle. */}
      <div className="kb-sortleiste kb-sortleiste--immer" role="group" aria-label="Startelf-Chance">
        <button
          type="button"
          className={`kb-sortchip${alleGruppen ? " kb-sortchip--aktiv" : ""}`}
          aria-pressed={alleGruppen}
          onClick={() => setElfWahl(new Set())}
        >
          Alle <span className="kb-chipzahl">{jeGruppe.get("alle")}</span>
        </button>
        <button
          type="button"
          className={`kb-sortchip${ohneNie ? " kb-sortchip--aktiv" : ""}`}
          aria-pressed={ohneNie}
          title="Alle außer denen, die definitiv nicht spielen"
          onClick={() => setElfWahl(ohneNie ? new Set() : new Set(OHNE_NIE))}
        >
          ohne ✕ <span className="kb-chipzahl">{jeGruppe.get("ohneNie")}</span>
        </button>
        {ELF_GRUPPEN.map((g) => {
          const anzahl = jeGruppe.get(g.schluessel) ?? 0;
          const an = elfWahl.has(g.schluessel);
          return (
            <button
              key={g.schluessel}
              type="button"
              role="checkbox"
              aria-checked={an}
              className={`kb-sortchip${an ? " kb-sortchip--aktiv" : ""}`}
              // Eine gewählte Gruppe bleibt abwählbar, auch wenn sie in
              // dieser Position gerade leer ist.
              disabled={anzahl === 0 && !an}
              onClick={() => gruppeUmschalten(g.schluessel)}
            >
              {g.label} <span className="kb-chipzahl">{anzahl}</span>
            </button>
          );
        })}
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

      {/* Sortierung fürs Handy: 24 h und 7 Tage haben dort keine eigene
          Spalte und damit keine Überschrift zum Antippen. */}
      <div className="kb-sortleiste" role="group" aria-label="Sortierung">
        {SPALTEN.filter((s) => s.key !== "position").map((s) => (
          <button
            key={s.key}
            type="button"
            className={`kb-sortchip${s.key === sortKey ? " kb-sortchip--aktiv" : ""}`}
            onClick={() => klick(s.key)}
          >
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
                    {/* Auf dem Handy stehen die beiden Bewegungen hier,
                        weil ihre Spalten keinen Platz haben. */}
                    <span className="kb-mwbewegung">
                      24h <Bewegung wert={s.mw24} kurz /> · 7T <Bewegung wert={s.mw7} kurz />
                    </span>
                  </td>
                  <td className="kb-sek"><Bewegung wert={s.mw24} /></td>
                  <td className="kb-sek"><Bewegung wert={s.mw7} /></td>
                  <td>
                    <Prognose p={s.prognose} zyklus={zyklus} />
                    <VorAnpfiff a={s.anpfiff} />
                  </td>
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
