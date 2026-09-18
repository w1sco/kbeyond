// Die aufgestellte Elf nach Punkteschnitt. Reine Rechnung, kein Server.
import { bewerteElf } from "../lib/elfstaerke.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};
const sp = (id, schnitt, aufgestellt = true) => ({ id, name: `S${id}`, schnitt, aufgestellt });

const MANAGER = [{ i: "1", n: "Anna" }, { i: "2", n: "Ben" }, { i: "3", n: "Cem" }, { i: "4", n: "Dora" }];
const KADER = new Map([
  ["1", [sp("a", 60), sp("b", 40), sp("c", 99, false)]],          // Bank zählt nicht
  ["2", [sp("d", 50), sp("e", null), sp("f", 30)]],               // einer ohne Schnitt
  ["3", [sp("g", 80, false), sp("h", 70, false)]],                // keine Aufstellung
  // Dora: gar kein Kader gespeichert
]);

const z = bewerteElf({ manager: MANAGER, kaderProManager: KADER });

pruefe("Reihenfolge: Summe absteigend, ohne Aufstellung hinten",
  z.map((x) => x.name), ["Anna", "Ben", "Cem", "Dora"]);
pruefe("Bank zählt nicht mit", z[0].summe, 100);
pruefe("Anzahl aufgestellt", z[0].aufgestellt, 2);
pruefe("Kadergröße daneben", z[0].kader, 3);

// Ein fehlender Schnitt ist eine Lücke, keine 0 – gezählt, nicht verschwiegen.
pruefe("ohne Schnitt zählt als 0 in der Summe", z[1].summe, 80);
pruefe("… und wird gezählt", z[1].ohneSchnitt, 1);
pruefe("ohne Schnitt sortiert ans Ende der Elf", z[1].elf.map((s) => s.id), ["d", "f", "e"]);

pruefe("keine Aufstellung: keine Summe", z[2].summe, null);
pruefe("keine Aufstellung: kein Rang", z[2].rang, null);
pruefe("kein Kader: keine Summe, kein Absturz", [z[3].summe, z[3].kader], [null, 0]);

// Ränge: gleiche Summe, gleicher Rang – der nächste springt.
const gleich = bewerteElf({
  manager: [{ i: "1", n: "A" }, { i: "2", n: "B" }, { i: "3", n: "C" }],
  kaderProManager: new Map([["1", [sp("a", 50)]], ["2", [sp("b", 50)]], ["3", [sp("c", 10)]]]),
});
pruefe("Rang bei Gleichstand", gleich.map((x) => x.rang), [1, 1, 3]);

// Schnitt als Text (aus der Datenbank kommt NUMERIC als Zeichenkette).
const text = bewerteElf({ manager: [{ i: "1", n: "A" }],
  kaderProManager: new Map([["1", [sp("a", "12.5"), sp("b", "7.5")]]]) });
pruefe("Zahlen als Text werden gerechnet", text[0].summe, 20);

pruefe("ohne alles: leer", bewerteElf(), []);

console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
