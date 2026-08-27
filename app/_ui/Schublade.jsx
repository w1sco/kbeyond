"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Off-Canvas: schiebt sich von rechts über die Seite.
//
// Geschlossen wird über die Verlaufsgeschichte (router.back), nicht über
// einen eigenen Zustand — dann schließt auch der Zurück-Knopf des Browsers
// die Schublade, statt die Ligaseite zu verlassen.
export default function Schublade({ titel, children }) {
  const router = useRouter();
  const flaeche = useRef(null);

  useEffect(() => {
    const beiTaste = (e) => {
      if (e.key === "Escape") router.back();
    };
    document.addEventListener("keydown", beiTaste);

    // Die Seite darunter soll nicht mitscrollen, solange die Schublade offen
    // ist — sonst verliert man beim Schließen seine Stelle in der Tabelle.
    const vorher = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", beiTaste);
      document.body.style.overflow = vorher;
    };
  }, [router]);

  return (
    <div
      className="kb-schublade-huelle"
      onMouseDown={(e) => {
        // Nur ein Klick auf die Fläche daneben schließt. Beim Mousedown
        // geprüft, damit eine Textauswahl, die im Inhalt beginnt und
        // draußen endet, die Schublade nicht zuklappt.
        if (e.target === flaeche.current) router.back();
      }}
      ref={flaeche}
      role="presentation"
    >
      <aside className="kb-schublade" role="dialog" aria-modal="true" aria-label={titel}>
        <div className="kb-schubladenkopf">
          <strong>{titel}</strong>
          <button className="kb-btn" onClick={() => router.back()} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="kb-schubladeninhalt">{children}</div>
      </aside>
    </div>
  );
}
