"use client";

// Hell oder dunkel umschalten.
//
// **Der Zustand steckt nicht in React.** Ein `useState`, das beim ersten
// Rendern aus dem localStorage liest, erzeugt auf dem Server einen anderen
// Baum als im Browser — genau der Hydrierungskonflikt, der in diesem
// Projekt schon einmal die Aufstellungsauswahl gekostet hat.
//
// Stattdessen: Ein Skript im <head> setzt `data-theme` am <html>, bevor
// gezeichnet wird, und **CSS** entscheidet, welches der beiden Symbole zu
// sehen ist. Dieser Knopf schreibt nur das Attribut um. Damit rendert
// Server und Browser dasselbe, egal welches Thema gilt.
export default function Thema() {
  function umschalten() {
    const el = document.documentElement;
    const dunkelJetzt = el.dataset.theme
      ? el.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;

    const neu = dunkelJetzt ? "light" : "dark";
    el.dataset.theme = neu;
    try {
      localStorage.setItem("kb-thema", neu);
    } catch {
      // Privater Modus: dann gilt die Wahl eben nur für diesen Besuch
    }
  }

  return (
    <button
      type="button"
      className="kb-thema"
      onClick={umschalten}
      title="Hell oder dunkel"
      aria-label="Zwischen hellem und dunklem Aussehen wechseln"
    >
      {/* Gezeigt wird, wohin der Klick führt. Welches Symbol sichtbar ist,
          steuert CSS – siehe oben. */}
      <svg className="kb-thema-mond" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
        <path
          d="M17 12.3A7.5 7.5 0 0 1 7.7 3 7.5 7.5 0 1 0 17 12.3Z"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
        />
      </svg>
      <svg className="kb-thema-sonne" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
        <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="10" y1="1.6" x2="10" y2="3.4" />
          <line x1="10" y1="16.6" x2="10" y2="18.4" />
          <line x1="1.6" y1="10" x2="3.4" y2="10" />
          <line x1="16.6" y1="10" x2="18.4" y2="10" />
          <line x1="4.1" y1="4.1" x2="5.4" y2="5.4" />
          <line x1="14.6" y1="14.6" x2="15.9" y2="15.9" />
          <line x1="15.9" y1="4.1" x2="14.6" y2="5.4" />
          <line x1="5.4" y1="14.6" x2="4.1" y2="15.9" />
        </g>
      </svg>
    </button>
  );
}
