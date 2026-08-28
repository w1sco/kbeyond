// Die Aufstellung steckt im Kader: Feld `lo`, null-basiert, Bank ohne Feld.
// Geprüft an einem ECHTEN Kader aus der Diagnoseseite (O-L-I, 14 Spieler).
import { startelfAus, startelfIds } from "../lib/aufstellung.js";

let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`      ist: ${JSON.stringify(ist)}  soll: ${JSON.stringify(soll)}`);
};

// Genau die Antwort von /managers/1142416/squad, gekürzt auf das Wesentliche
const echt = [
  { pi: "15262", pn: "De Cat",      pos: 3, lo: 6 },
  { pi: "15589", pn: "Otávio",      pos: 2, lo: 2 },
  { pi: "7215",  pn: "Makengo",     pos: 2, lo: 1 },
  { pi: "3166",  pn: "Topp",        pos: 4, st: 1, stl: [1] },
  { pi: "12158", pn: "Vozar",       pos: 3 },
  { pi: "11675", pn: "Díaz",        pos: 4, lo: 7 },
  { pi: "1223",  pn: "Friedrich",   pos: 2, st: 2, stl: [2] },
  { pi: "3281",  pn: "Reis",        pos: 3, lo: 5 },
  { pi: "3129",  pn: "Itakura",     pos: 2, lo: 3 },
  { pi: "9642",  pn: "Matsima",     pos: 2, lo: 4 },
  { pi: "9698",  pn: "Fábio Silva", pos: 4, lo: 8 },
  { pi: "11949", pn: "Nandja",      pos: 2 },
  { pi: "1580",  pn: "Schwäbe",     pos: 1, lo: 0 },
  { pi: "10106", pn: "Ljubicic",    pos: 4, lo: 9 },
];

const drin = startelfAus(echt);
const namen = echt.filter((_, i) => drin[i]).map((s) => s.pn);
const bank = echt.filter((_, i) => !drin[i]).map((s) => s.pn);

console.log("Echter Kader von O-L-I (14 Spieler):");
pruefe("zehn aufgestellt", drin.filter(Boolean).length, 10);
pruefe("der Torwart (lo 0) ist dabei", namen.includes("Schwäbe"), true);
pruefe("genau ein Torwart aufgestellt",
  echt.filter((s, i) => drin[i] && s.pos === 1).length, 1);
pruefe("die Bank stimmt", bank.sort(), ["Friedrich", "Nandja", "Topp", "Vozar"]);
pruefe("teuerster Spieler ohne lo bleibt draußen", namen.includes("Topp"), false);
pruefe("IDs statt Namen", startelfIds(echt).size, 10);
pruefe("die richtige ID des Torwarts", startelfIds(echt).has("1580"), true);

console.log("\nAlle Größen von 0 bis 11:");
const bau = (n) => Array.from({ length: 14 }, (_, i) => (i < n ? { pi: String(i), lo: i } : { pi: String(i) }));
for (const n of [0, 1, 5, 7, 10, 11]) {
  const r = startelfAus(bau(n));
  pruefe(`${n} aufgestellt`, r ? r.filter(Boolean).length : 0, n);
}

console.log("\nWas nicht als Aufstellung zählt:");
pruefe("lo = 11 (jenseits der elf Plätze)",
  startelfAus([{ pi: "1", lo: 11 }, { pi: "2" }]), null);
pruefe("lo negativ", startelfAus([{ pi: "1", lo: -1 }, { pi: "2" }]), null);
pruefe("lo als Text mit Zahl", startelfAus([{ pi: "1", lo: "3" }, { pi: "2" }]).filter(Boolean).length, 1);
pruefe("lo als Unsinn", startelfAus([{ pi: "1", lo: "morgen" }, { pi: "2" }]), null);
pruefe("leere Liste", startelfAus([]), null);
pruefe("kein Array", startelfAus(null), null);

console.log(fehler ? `\n${fehler} Fall/Fälle falsch` : "\nAlle Fälle richtig.");
process.exit(fehler ? 1 : 0);
