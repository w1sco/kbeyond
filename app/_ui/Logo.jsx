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

// ── Das Fernglas im Schriftzug ──────────────────────────────────────
//
// „o" und die Schale des „d" sind zwei Kreise – die Form von
// Fernglaslinsen, mit dem „n" als Brücke dazwischen. Ein zarter Innenring
// macht das sichtbar, ohne das Wort anzutasten.
//
// **Die Buchstaben kommen aus der Schrift, nicht aus meiner Hand.** Ein
// erster Versuch hat „ond" nachgezeichnet; das „n" wurde dabei zum ∩ und
// der Schriftzug unlesbar. Hier steht echter Text **innerhalb** der SVG,
// damit Buchstaben und Linsen in einem Koordinatensystem liegen und nichts
// ausgerichtet werden muss.
//
// Maße aus Geist 640 gemessen: „ond" 181,7 bei Schriftgröße 100,
// Oberlänge 71, x-Höhe 54. Laufweite −0,025 em = −2,5 Einheiten.
const SPUR = -2.5;
const OND_BREITE = 181.7 + SPUR * 2;
const GRUNDLINIE = 71;
const LINSE_Y = GRUNDLINIE - 27;
const LINSE_R = 7;

function Ond() {
  return (
    <svg
      viewBox={`0 0 ${OND_BREITE} ${GRUNDLINIE}`}
      className="kb-ond"
      style={{ width: `${OND_BREITE / 100}em`, height: `${GRUNDLINIE / 100}em` }}
      aria-hidden="true"
    >
      {/* Familie und Schnitt erbt der Text aus dem CSS – nur die Größe
          muss in Nutzereinheiten stehen, damit sie mit skaliert. */}
      <text x="0" y={GRUNDLINIE} fontSize="100" letterSpacing={SPUR} fill="currentColor">
        ond
      </text>
      <g fill="none" stroke="currentColor" strokeWidth="3">
        <circle cx="30.45" cy={LINSE_Y} r={LINSE_R} />
        <circle cx={145.5 + SPUR * 2} cy={LINSE_Y} r={LINSE_R} />
      </g>
    </svg>
  );
}

// Zeichen und Schriftzug zusammen. `gross` für die Einstiegsseiten.
//
// **Die Linsen nur im großen Schriftzug.** Bei 19 px in der Kopfleiste
// sind sie zwei Punkte von zwei Pixeln – sie tragen dort nichts und
// trüben nur die Buchstaben. Gemessen bei 48, 34, 26 und 19 px.
export default function Logo({ gross = false, ohneText = false }) {
  return (
    <span className={`kb-logo${gross ? " kb-logo--gross" : ""}`}>
      <Zeichen groesse={gross ? 40 : 28} id={gross ? "kb-gross" : "kb-klein"} />
      {!ohneText && (
        <span className="kb-wortmarke">
          <span className="kb-wortmarke-k">K</span>
          {gross ? <>Bey<Ond /></> : "Beyond"}
        </span>
      )}
    </span>
  );
}
