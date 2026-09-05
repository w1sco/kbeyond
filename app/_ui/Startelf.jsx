import { stufe } from "@/lib/startelf";

// Das Zeichen, das Kickbase vor jeden Spieler setzt: wie sicher steht er
// am kommenden Spieltag in der Startelf.
//
// **Ohne Angabe steht hier nichts** — kein Platzhalter, kein „unbekannt".
// Dieselbe Regel wie beim Spielerbild: Eine leere Scheibe vor jedem Namen
// sagt nichts aus und stiehlt nur Platz. Und ein geratenes Zeichen wäre
// hier schlimmer als gar keins, denn danach stellt jemand auf.
export default function Startelf({ wert }) {
  const s = stufe(wert);
  if (!s) return null;
  return (
    <span
      className={`kb-elf ${s.klasse}`}
      title={`Startelf: ${s.name} · Einschätzung von Ligainsider, über Kickbase`}
    >
      <span aria-hidden="true">{s.zeichen}</span>
      <span className="kb-nurvorleser">Startelf: {s.name}</span>
    </span>
  );
}
