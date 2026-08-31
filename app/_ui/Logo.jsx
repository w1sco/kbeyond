// Das Zeichen: eine Linie, die steigt und oben aus dem Feld herausläuft.
//
// Warum so: „KBeyond" heißt, über das hinauszusehen, was Kickbase zeigt.
// Eine Kurve, die den Rahmen verlässt, sagt das ohne Worte — und die
// Grundlinie unten ist dieselbe Anspielung aufs Spielfeld wie in der
// Aufstellungsgrafik.
//
// **Inline-SVG, keine Bilddatei.** Skaliert verlustfrei, färbt sich über
// `currentColor` mit und kostet keinen zusätzlichen Ladevorgang.

export function Zeichen({ groesse = 28, id = "kb" }) {
  return (
    <svg
      width={groesse}
      height={groesse}
      viewBox="0 0 44 44"
      aria-hidden="true"
      focusable="false"
      className="kb-zeichen"
    >
      <defs>
        <linearGradient id={`${id}-verlauf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>

      <rect x="0" y="9" width="35" height="35" rx="10" fill={`url(#${id}-verlauf)`} />

      {/* Zwei Rasenstreifen, sehr zurückhaltend – dieselbe Anspielung wie
          auf dem gezeichneten Spielfeld. */}
      <rect x="9" y="9" width="6" height="35" fill="#fff" opacity="0.07" />
      <rect x="23" y="9" width="6" height="35" fill="#fff" opacity="0.07" />

      {/* Grundlinie */}
      <line
        x1="7" y1="37" x2="28" y2="37"
        stroke="#fff" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round"
      />

      {/* Die Kurve im Feld – weiß */}
      <path
        d="M7 33 L15 26 L21 29 L29 19"
        fill="none" stroke="#fff" strokeWidth="3.4"
        strokeLinecap="round" strokeLinejoin="round"
      />

      {/* Und darüber hinaus. Außerhalb des Felds wäre Weiß unsichtbar –
          deshalb wechselt der Strich hier auf die Markenfarbe. Genau
          dieser Bruch ist die Aussage: über das hinaus, was Kickbase zeigt. */}
      <path
        d="M29 19 L38 8"
        fill="none" stroke="#4338ca" strokeWidth="3.4" strokeLinecap="round"
      />
      <circle cx="39" cy="6" r="4" fill="#4338ca" />
    </svg>
  );
}

// Zeichen und Schriftzug zusammen. `gross` für die Einstiegsseiten.
export default function Logo({ gross = false, ohneText = false }) {
  return (
    <span className={`kb-logo${gross ? " kb-logo--gross" : ""}`}>
      <Zeichen groesse={gross ? 40 : 28} id={gross ? "kb-gross" : "kb-klein"} />
      {!ohneText && (
        <span className="kb-wortmarke">
          <span className="kb-wortmarke-k">K</span>Beyond
        </span>
      )}
    </span>
  );
}
