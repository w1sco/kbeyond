import { zeitpunkt } from "@/lib/format";

// Wann kommt ein Spieler (wieder) an den Markt — und läuft sein Angebot
// noch vor dem Anpfiff aus? Gerechnet wird in lib/rhythmus.js; hier steht
// nur, wie es aussieht. Markt- und Matchup-Seite zeigen es gleich.

// Das Zeichen zur Frage „läuft er noch vor dem Anpfiff aus?"
export function VorAnpfiff({ a }) {
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

export function Prognose({ p, zyklus }) {
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
