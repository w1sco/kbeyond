// Die echte Startelf finden, ohne den Feldnamen zu kennen.
import { findeAufstellung } from "../lib/aufstellung.js";

let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`      ist:  ${JSON.stringify(ist)}\n      soll: ${JSON.stringify(soll)}`);
};

// 18 Spieler, davon 11 in der Startelf
const kader = (feld, werte, extra = () => ({})) =>
  werte.map((w, i) => ({ i: String(100 + i), mv: 5_000_000 + i * 1000, pos: (i % 4) + 1,
                         [feld]: w, ...extra(i) }));

const wieViele = (r) => (r ? r.drin.filter(Boolean).length : null);
const ersteElf = (r) => (r ? r.drin.slice(0, 13) : null);

console.log("Muster 1 — Reihenfolge (Startelf 1–11, Bank 12–18):");
const reihenfolge = [...Array(11)].map((_, i) => i + 1).concat([12,13,14,15,16,17,18]);
pruefe("elf erkannt", wieViele(findeAufstellung(kader("lo", reihenfolge))), 11);
pruefe("die richtigen elf", ersteElf(findeAufstellung(kader("lo", reihenfolge))),
  [true,true,true,true,true,true,true,true,true,true,true,false,false]);
pruefe("Feld benannt", findeAufstellung(kader("lo", reihenfolge)).feld, "lo");
pruefe("Art benannt", findeAufstellung(kader("lo", reihenfolge)).art, "Reihenfolge 1–11");
pruefe("Bank leer statt nummeriert",
  wieViele(findeAufstellung(kader("lineup_order", [...Array(11)].map((_,i)=>i+1).concat(Array(7).fill(null))))), 11);
pruefe("Reihenfolge mit Lücke wird verworfen",
  findeAufstellung(kader("lo", [1,2,3,4,5,6,7,8,9,10,10,12,13,14,15,16,17,18])), null);

console.log("\nMuster 2 — Wahrheitswert:");
pruefe("elf mal true",
  wieViele(findeAufstellung(kader("inLineup", [...Array(11).fill(true), ...Array(7).fill(false)]))), 11);
pruefe("zehn mal true wird verworfen",
  findeAufstellung(kader("inLineup", [...Array(10).fill(true), ...Array(8).fill(false)])), null);

console.log("\nMuster 3 — Status-Code (1 = Startelf, 2 = Bank):");
const status = [...Array(11).fill(1), ...Array(7).fill(2)];
pruefe("elf erkannt", wieViele(findeAufstellung(kader("lineup_status", status))), 11);
pruefe("die richtigen elf", ersteElf(findeAufstellung(kader("lineup_status", status))),
  [true,true,true,true,true,true,true,true,true,true,true,false,false]);
pruefe("Bank als 0",
  wieViele(findeAufstellung(kader("st", [...Array(11).fill(2), ...Array(7).fill(0)]))), 11);
pruefe("drei Status, einer genau elfmal",
  wieViele(findeAufstellung(kader("st", [...Array(11).fill("S"), ...Array(4).fill("B"), ...Array(3).fill("X")]))), 11);
pruefe("kein Wert genau elfmal → nichts",
  findeAufstellung(kader("st", [...Array(9).fill(1), ...Array(9).fill(2)])), null);

console.log("\nWas NICHT als Aufstellung durchgehen darf:");
pruefe("Spieler-ID (elf IDs zwischen 1 und 11)",
  findeAufstellung(Array.from({ length: 18 }, (_, i) => ({ i: String(i), mv: 9_000_000 + i }))), null);
pruefe("Marktwerte", findeAufstellung(
  Array.from({ length: 18 }, (_, i) => ({ mv: 1_000_000 * (i + 1) }))), null);
pruefe("Position mit vier Werten",
  findeAufstellung(Array.from({ length: 18 }, (_, i) => ({ pos: i < 11 ? 3 : 2 }))), null);
pruefe("gar kein Kennzeichen", findeAufstellung(
  Array.from({ length: 18 }, (_, i) => ({ zufall: 1000 + i * 7 }))), null);

console.log("\nGrenzfälle:");
pruefe("Kader mit elf Spielern spielt komplett",
  wieViele(findeAufstellung(Array.from({ length: 11 }, (_, i) => ({ i: String(i) })))), 11);
pruefe("Kader mit acht Spielern",
  wieViele(findeAufstellung(Array.from({ length: 8 }, (_, i) => ({ i: String(i) })))), 8);
pruefe("leere Liste", findeAufstellung([]), null);
pruefe("kein Array", findeAufstellung(null), null);
pruefe("bekanntes Feld hat Vorrang vor zufälligem",
  findeAufstellung(kader("lo", reihenfolge, (i) => ({ zufall: i < 11 }))).feld, "lo");


// ── elfAus: die Antwort des /lineup-Endpunkts ──────────────────────
const { elfAus } = await import("../lib/aufstellung.js");

const eintrag = (i, extra = {}) => ({ i: String(i), n: `S${i}`, ap: 24, ...extra });

console.log("\nelfAus — Startelf aus der Endpunkt-Antwort:");

// Der Fall, der den Torwart verschluckt hat: lo beginnt bei 0.
const nullBasiert = { it: Array.from({ length: 15 }, (_, i) => eintrag(100 + i, { lo: i })) };
pruefe("lo ab 0: elf Spieler", elfAus(nullBasiert).ids.size, 11);
pruefe("lo ab 0: der mit lo=0 ist dabei", elfAus(nullBasiert).ids.has("100"), true);
pruefe("lo ab 0: der mit lo=11 ist NICHT dabei", elfAus(nullBasiert).ids.has("111"), false);
pruefe("lo ab 0: Art benannt", elfAus(nullBasiert).art, "lo 0–10");

const einsBasiert = { it: Array.from({ length: 15 }, (_, i) => eintrag(200 + i, { lo: i + 1 })) };
pruefe("lo ab 1: elf Spieler", elfAus(einsBasiert).ids.size, 11);
pruefe("lo ab 1: der mit lo=1 ist dabei", elfAus(einsBasiert).ids.has("200"), true);
pruefe("lo ab 1: Art benannt", elfAus(einsBasiert).art, "lo 1–11");

// Statusfeld gewinnt gegen lo
const mitStatus = { it: Array.from({ length: 15 }, (_, i) =>
  eintrag(300 + i, { lo: i, lst: i < 11 ? 1 : 0 })) };
pruefe("Statusfeld erkannt", elfAus(mitStatus).art, "lst = 1");
pruefe("Statusfeld: elf Spieler", elfAus(mitStatus).ids.size, 11);

// Genau elf Einträge
const nurElf = { it: Array.from({ length: 11 }, (_, i) => eintrag(400 + i)) };
pruefe("genau elf ohne Kennzeichen", elfAus(nurElf).ids.size, 11);
pruefe("Art benannt", elfAus(nurElf).art, "Liste enthält genau elf");

pruefe("leere Antwort", elfAus({ it: [] }), null);
pruefe("kein Array", elfAus({}), null);
pruefe("zwölf ohne Kennzeichen → nichts",
  elfAus({ it: Array.from({ length: 12 }, (_, i) => eintrag(500 + i)) }), null);

console.log(fehler ? `\n${fehler} Fall/Fälle falsch` : "\nAlle Fälle richtig.");
process.exit(fehler ? 1 : 0);
