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

// ── Das K als Diagramm ─────────────────────────────────────────────
//
// Der Stamm des K ist die y-Achse, die beiden Schenkel sind Linien eines
// Diagramms — und der obere bricht oben rechts aus und fliegt über das
// Wort hinweg: „Beyond".
//
// **Der Buchstabe kommt aus der Schrift, die Geometrie aus der Messung.**
// Ein erster Ausbruch war frei geschätzt und knickte sichtbar ab. Aus den
// Pixeln des gerenderten K abgelesen (Geist 640, Größe 100):
//   Stamm-Außenkante x = 7,75 · oberer Schenkel (57,75|8) → (39|32),
//   Steigung dy/dx = −1,28 · Versalhöhe 71 · Vorschub 67,9
//
// Der Bogen setzt genau in dieser Richtung an und flacht dann ab.
const KAP = 71;
const K_VOR = 67.9;
const K_HOCH = 62;                       // Luft über der Versalhöhe
const SPITZE = { x: 59, y: 7.5 };        // Ansatz am oberen Schenkel
const STEUER = { x: 79, y: -18 };        // Tangente in Schenkelrichtung
const ZIEL = { x: 133.9, y: -54 };       // über dem „Be"

function DiagrammK() {
  return (
    <svg
      viewBox={`0 ${-K_HOCH} ${K_VOR} ${KAP + K_HOCH}`}
      className="kb-diagramm-k"
      style={{
        width: `${K_VOR / 100}em`, height: `${(KAP + K_HOCH) / 100}em`,
        // **Nicht `margin-bottom`.** Bei `vertical-align: baseline` ist die
        // Unterkante des Kastens der Ausrichtungspunkt – und die liegt hier
        // schon genau auf der Grundlinie des K. Ein negativer unterer Rand
        // schiebt den Buchstaben deshalb nach unten statt nach oben.
        // Die Luft über der Versalhöhe kommt oben wieder weg, damit die
        // Zeile nicht aufgeht.
        marginTop: `${-K_HOCH / 100}em`,
      }}
      aria-hidden="true"
    >
      <text x="0" y={KAP} fontSize="100" fill="currentColor">K</text>
      {/* Der Ausbruch liegt außerhalb der viewBox – `overflow: visible`
          malt ihn trotzdem. Reservierte die SVG den Platz, drifteten K
          und „Beyond" auseinander. */}
      <path
        d={`M${SPITZE.x} ${SPITZE.y} Q${STEUER.x} ${STEUER.y} ${ZIEL.x} ${ZIEL.y}`}
        fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round"
      />
      <circle cx={ZIEL.x} cy={ZIEL.y} r="8.5" fill="currentColor" />
    </svg>
  );
}

// „ond" mit **einem** Auge im o. Zwei Linsen (o und d) waren zu viel —
// der Schriftzug wurde unruhig, und bei kleiner Größe blieb davon nur
// Schmutz. Der Text steht in der SVG, damit Buchstabe und Auge in einem
// Koordinatensystem liegen; ihn nachzuzeichnen ging schief (das „n„
// wurde zum ∩).
const SPUR = -2.5;
const OND_BREITE = 181.7 + SPUR * 2;

function Ond() {
  return (
    <svg
      viewBox={`0 0 ${OND_BREITE} ${KAP}`}
      className="kb-ond"
      style={{ width: `${OND_BREITE / 100}em`, height: `${KAP / 100}em` }}
      aria-hidden="true"
    >
      <text x="0" y={KAP} fontSize="100" letterSpacing={SPUR} fill="currentColor">
        ond
      </text>
      <circle cx="30.45" cy={KAP - 27} r="7" fill="none"
              stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

// Zwei Fassungen, und das mit Absicht.
//
// **Groß (Login, Ligaauswahl): das K trägt alles, kein Abzeichen.** Beide
// nebeneinander erzählen zweimal dasselbe — eine Linie, die ihren Rahmen
// verlässt. Nebeneinander gestellt sah das unruhig und redundant aus.
//
// **Klein (Kopfleiste, 19 px): Abzeichen und schlichter Schriftzug.** Der
// Bogen wäre dort ein Kratzer von einem Pixel über dem B, und das Auge im
// o ein Schmutzpunkt. Durchgesehen bei 44, 28 und 19 px.
export default function Logo({ gross = false, ohneText = false }) {
  if (gross) {
    return (
      <span className="kb-logo kb-logo--gross">
        <span className="kb-wortmarke">
          <span className="kb-wortmarke-k"><DiagrammK /></span>
          Bey<Ond />
        </span>
      </span>
    );
  }
  return (
    <span className="kb-logo">
      <Zeichen groesse={28} id="kb-klein" />
      {!ohneText && (
        <span className="kb-wortmarke">
          <span className="kb-wortmarke-k">K</span>Beyond
        </span>
      )}
    </span>
  );
}
