// Das Zeichen: ein **Liniendiagramm, aus dem der Buchstabe entsteht**.
//
// Der Stamm ist zugleich y-Achse und Buchstabenstamm, unten läuft die
// x-Achse, und die beiden Schenkel des K sind zwei Datenreihen — eine
// steigt, eine fällt.
//
// Warum zwei Reihen und nicht eine Linie: **Eine Diagrammlinie kann in x
// nicht zurücklaufen.** Ein einzelner Streckenzug könnte die beiden
// Schenkel gar nicht bilden. Zwei Reihen, die an derselben Stelle von der
// Achse weggehen, sind die einzige Form, die zugleich ein ehrliches
// Diagramm und ein K ist.
//
// **Der Stamm hat volle Strichstärke.** Mit einer dünnen Achse — wie ein
// Diagramm sie hätte — las sich das Zeichen als „<" mit einem Strich
// daneben. Die Diagramm-Lesart tragen dafür die x-Achse und die
// Proportionen.
//
// **Inline-SVG, keine Bilddatei.** Skaliert verlustfrei und kostet keinen
// zusätzlichen Ladevorgang. Die Grundlinie unten ist zugleich dieselbe
// Anspielung aufs Spielfeld wie in der Aufstellungsgrafik.

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

      <rect x="1" y="5" width="38" height="38" rx="10" fill={`url(#${id}-verlauf)`} />

      {/* x-Achse, zurückhaltend. Zugleich dieselbe Anspielung aufs
          Spielfeld wie in der Aufstellungsgrafik. */}
      <line x1="13" y1="37.5" x2="30" y2="37.5"
            stroke="#fff" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" />

      {/* Der Stamm ist y-Achse **und** Buchstabenstamm – deshalb in voller
          Strichstärke. Mit einer dünnen Achse las sich das Zeichen als „<"
          mit einem Strich daneben, nicht als K. */}
      <line x1="13" y1="12" x2="13" y2="35"
            stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />

      {/* Zwei Reihen, die an derselben Stelle von der Achse weggehen: eine
          steigt, eine fällt. Eine Diagrammlinie kann in x nicht
          zurücklaufen – die beiden Schenkel des K *müssen* deshalb zwei
          Reihen sein. Genau daraus entsteht der Buchstabe. */}
      <g fill="none" stroke="#fff" strokeWidth="3.4"
         strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 24 L28 13" />
        <path d="M13 24 L28 34" />
      </g>

      {/* **Kein Anbau nach außen.** Ein austretender Strich mit Punkt sah
          bei jeder Länge aus wie ein eingeschlagener Nagel — verglichen in
          vier Abstufungen bei 112, 40, 28 und 18 px. Das „Beyond" trägt der
          Name; das Zeichen bleibt ruhig. */}
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
