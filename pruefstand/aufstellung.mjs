// Die echte Startelf finden, ohne den Feldnamen zu kennen.
import { findeAufstellung } from "../lib/format.js";

let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`      ist:  ${JSON.stringify(ist)}\n      soll: ${JSON.stringify(soll)}`);
};

// Ein Kader mit 18 Spielern, davon 11 aufgestellt
const kader = (feld, werte, extra = {}) =>
  werte.map((w, i) => ({ i: String(100 + i), mv: 5_000_000 + i * 1000, pos: (i % 4) + 1, [feld]: w, ...extra }));

const elfMalTrue = [...Array(11).fill(true), ...Array(7).fill(false)];
const elfMalNummer = [...Array(11).fill(0).map((_, i) => i + 1), ...Array(7).fill(0)];

pruefe("Feld 'lo' mit 11 Nummern",
  findeAufstellung(kader("lo", elfMalNummer)).filter(Boolean).length, 11);
pruefe("unbekanntes Feld mit 11 true",
  findeAufstellung(kader("irgendwas", elfMalTrue)).filter(Boolean).length, 11);
pruefe("die richtigen elf",
  findeAufstellung(kader("lo", elfMalNummer)).slice(0, 13),
  [true,true,true,true,true,true,true,true,true,true,true,false,false]);

pruefe("nur 10 markiert → nichts", findeAufstellung(
  kader("lo", [...Array(10).fill(1), ...Array(8).fill(0)])), null);
pruefe("12 markiert → nichts", findeAufstellung(
  kader("lo", [...Array(12).fill(1), ...Array(6).fill(0)])), null);
pruefe("gar kein Kennzeichen → nichts", findeAufstellung(
  Array.from({ length: 18 }, (_, i) => ({ i: String(i), mv: 9_000_000 + i }))), null);

pruefe("Kader mit 11 Spielern spielt komplett",
  findeAufstellung(Array.from({ length: 11 }, (_, i) => ({ i: String(i) }))).filter(Boolean).length, 11);
pruefe("Kader mit 8 Spielern spielt komplett",
  findeAufstellung(Array.from({ length: 8 }, (_, i) => ({ i: String(i) }))).filter(Boolean).length, 8);

pruefe("leere Liste", findeAufstellung([]), null);
pruefe("kein Array", findeAufstellung(null), null);

// Marktwerte dürfen nie als Aufstellung durchgehen
pruefe("Marktwert wird nicht verwechselt",
  findeAufstellung(Array.from({ length: 18 }, (_, i) => ({ mv: 1_000_000 * (i + 1) }))), null);

// Bekanntes Feld gewinnt gegen ein zufällig passendes anderes
const gemischt = kader("lo", elfMalNummer).map((s, i) => ({ ...s, zufall: i < 11 ? 0 : 1 }));
pruefe("bekanntes Feld hat Vorrang",
  findeAufstellung(gemischt).slice(0, 12),
  [true,true,true,true,true,true,true,true,true,true,true,false]);

console.log(fehler ? `\n${fehler} Fall/Fälle falsch` : "\nAlle Fälle richtig.");
process.exit(fehler ? 1 : 0);
