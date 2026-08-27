// Die Kickbase-Regel: (Mannschaftswert + Konto) × 0,33 + Konto
import { erlaubtesMinus, maxGebot } from "../lib/gebot.js";

let fehler = 0;
const eur = (n) => n.toLocaleString("de-DE") + " €";
const pruefe = (name, ist, soll) => {
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(46)} ${eur(ist)}${ok ? "" : `  (erwartet ${eur(soll)})`}`);
};

const M = 1_000_000;

console.log("Konto im Plus (10 Mio) bei 150 Mio Teamwert:");
pruefe("erlaubtes Minus = 160 × 0,33", erlaubtesMinus(150 * M, 10 * M), 52_800_000);
pruefe("Max-Gebot = Konto + Minus",    maxGebot(150 * M, 10 * M),       62_800_000);

console.log("\nKonto im Minus (−10 Mio) bei 150 Mio Teamwert:");
pruefe("erlaubtes Minus = 140 × 0,33", erlaubtesMinus(150 * M, -10 * M), 46_200_000);
pruefe("Max-Gebot",                    maxGebot(150 * M, -10 * M),       36_200_000);

console.log("\nKonto bei null — nur hier gleich der alten Rechnung:");
pruefe("erlaubtes Minus",              erlaubtesMinus(150 * M, 0),       49_500_000);
pruefe("alte Rechnung Teamwert ÷ 3",   Math.floor(150 * M / 3),          50_000_000);

console.log("\nGrenzfälle:");
pruefe("kein Teamwert, Konto 5 Mio",   erlaubtesMinus(0, 5 * M),          1_650_000);
pruefe("alles null",                   erlaubtesMinus(0, 0),                      0);
pruefe("Vermögen negativ → kein Minus", erlaubtesMinus(10 * M, -20 * M),          0);
pruefe("Max-Gebot bleibt dann Konto",  maxGebot(10 * M, -20 * M),        -20_000_000);
pruefe("undefined wird 0",             erlaubtesMinus(undefined, undefined),      0);

// Die Probe aufs Exempel: Wer sein Max-Gebot ausgibt, steht genau auf der Grenze.
const tw = 87 * M, konto = 3_500_000;
const gebot = maxGebot(tw, konto);
pruefe("nach dem Höchstgebot genau auf der Grenze",
  konto - gebot, -erlaubtesMinus(tw, konto));

console.log(fehler ? `\n${fehler} Fall/Fälle falsch` : "\nAlle Fälle richtig.");
process.exit(fehler ? 1 : 0);
