// Erlaubtes Minus und Max-Gebot — die Kickbase-Regel.
//
// ```
// erlaubtes Minus = (Mannschaftswert + Kontostand) × 0,33
// Max-Gebot       = Kontostand + erlaubtes Minus
// ```
//
// Der Kontostand steckt **in der Basis mit drin**. Eine frühere Fassung
// rechnete schlicht `Teamwert ÷ 3` und lag damit bei jedem Manager daneben,
// dessen Konto nicht bei null steht — im Minus zu hoch, im Plus zu niedrig.
//
// Lesart: Das erlaubte Minus ist der Betrag, den man nach einem
// angenommenen Gebot maximal im Minus stehen darf. Wer bietet, hat danach
// `Konto − Gebot`; das muss über `−erlaubtes Minus` bleiben.
//
// Reine Rechnung, keine Datenbank — damit sie sich durchrechnen lässt.
export const MINUS_ANTEIL = 0.33;

export function erlaubtesMinus(teamwert, konto) {
  const basis = Number(teamwert ?? 0) + Number(konto ?? 0);
  // Ein negatives „erlaubtes Minus" ergibt keinen Sinn. Bei einem
  // Gesamtvermögen unter null bleibt es bei null.
  return basis <= 0 ? 0 : Math.floor(basis * MINUS_ANTEIL);
}

export function maxGebot(teamwert, konto) {
  return Number(konto ?? 0) + erlaubtesMinus(teamwert, konto);
}
