"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Zwischen Managern blättern — mit Pfeiltasten, per Wischen und über zwei
// Knöpfe.
//
// Die Knöpfe sind nicht Beiwerk: Tastatur und Wischgeste sind unsichtbar,
// und was man nicht sieht, findet man nicht. Sie sind außerdem der einzige
// Weg für alle, die weder das eine noch das andere benutzen.
//
// Die Reihenfolge ist die der Ligatabelle in ihrer Grundsortierung
// (Gesamtwert absteigend) — dieselbe, aus der man die Seite aufruft.

// Wie weit muss gewischt werden, damit es zählt. Darunter ist es eher ein
// Verrutschen beim Scrollen.
const WISCH_PX = 60;

export default function Blaettern({ leagueId, vorher, nachher }) {
  const router = useRouter();
  const start = useRef(null);

  useEffect(() => {
    const geh = (m) => {
      if (m) router.push(`/liga/manager/${m.id}?league=${leagueId}`);
    };

    const beiTaste = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // Nicht blättern, während jemand tippt oder einen Regler bedient.
      const ziel = e.target;
      const tag = ziel?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || ziel?.isContentEditable) return;

      if (e.key === "ArrowLeft") geh(vorher);
      else if (e.key === "ArrowRight") geh(nachher);
    };

    const beiStart = (e) => {
      const b = e.touches?.[0];
      start.current = b ? { x: b.clientX, y: b.clientY } : null;
    };

    const beiEnde = (e) => {
      const a = start.current;
      start.current = null;
      const b = e.changedTouches?.[0];
      if (!a || !b) return;

      const dx = b.clientX - a.x;
      const dy = b.clientY - a.y;
      // Waagerecht muss deutlich überwiegen, sonst war es Scrollen.
      if (Math.abs(dx) < WISCH_PX || Math.abs(dx) < Math.abs(dy) * 2) return;

      if (dx < 0) geh(nachher);
      else geh(vorher);
    };

    document.addEventListener("keydown", beiTaste);
    document.addEventListener("touchstart", beiStart, { passive: true });
    document.addEventListener("touchend", beiEnde, { passive: true });
    return () => {
      document.removeEventListener("keydown", beiTaste);
      document.removeEventListener("touchstart", beiStart);
      document.removeEventListener("touchend", beiEnde);
    };
  }, [router, leagueId, vorher, nachher]);

  if (!vorher && !nachher) return null;

  return (
    <nav className="kb-blaettern" aria-label="Zwischen Managern wechseln">
      <button
        className="kb-btn kb-blaettern-knopf"
        disabled={!vorher}
        onClick={() => vorher && router.push(`/liga/manager/${vorher.id}?league=${leagueId}`)}
        title={vorher ? `${vorher.name} (Pfeil links oder nach rechts wischen)` : "Erster Manager"}
      >
        ← {vorher?.name ?? "—"}
      </button>

      <button
        className="kb-btn kb-blaettern-knopf"
        disabled={!nachher}
        onClick={() => nachher && router.push(`/liga/manager/${nachher.id}?league=${leagueId}`)}
        title={nachher ? `${nachher.name} (Pfeil rechts oder nach links wischen)` : "Letzter Manager"}
      >
        {nachher?.name ?? "—"} →
      </button>
    </nav>
  );
}
