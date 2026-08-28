// Der Admin zählt nur, wenn er auch spielt.
import { spieltMit, nurMitspieler } from "../lib/manager.js";

let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`      ist: ${JSON.stringify(ist)}  soll: ${JSON.stringify(soll)}`);
};

pruefe("normaler Manager",                 spieltMit({ i: "1", tv: 150e6, sp: 300 }), true);
pruefe("normaler Manager ohne alles",      spieltMit({ i: "1", tv: 0, sp: 0 }), true);
pruefe("Admin ohne Mannschaft",            spieltMit({ i: "9", adm: true, tv: 0, sp: 0 }), false);
pruefe("Admin ohne Felder",                spieltMit({ i: "9", adm: true }), false);
pruefe("Admin MIT Mannschaft",             spieltMit({ i: "9", adm: true, tv: 120e6, sp: 0 }), true);
pruefe("Admin mit Punkten",                spieltMit({ i: "9", adm: true, tv: 0, sp: 240 }), true);
pruefe("Admin, adm als Text",              spieltMit({ i: "9", adm: "true", tv: 0 }), true);
pruefe("nichts",                           spieltMit(null), false);

const liga = [
  { i: "1", n: "Anna", tv: 150e6 },
  { i: "2", n: "Bert", tv: 140e6 },
  { i: "9", n: "Admin", adm: true, tv: 0, sp: 0 },
];
pruefe("Liga ohne mitspielenden Admin",
  nurMitspieler(liga).map((m) => m.n), ["Anna", "Bert"]);

const ligaMitAdmin = [...liga.slice(0, 2), { i: "9", n: "Admin", adm: true, tv: 130e6 }];
pruefe("Liga mit mitspielendem Admin",
  nurMitspieler(ligaMitAdmin).map((m) => m.n), ["Anna", "Bert", "Admin"]);

// Direkt nach einem Reset steht überall 0 – dann hilft nur eigenes Wissen.
pruefe("nach Reset: Admin ohne Kader bleibt draußen",
  nurMitspieler(liga, new Set(["1", "2"])).map((m) => m.n), ["Anna", "Bert"]);
pruefe("nach Reset: Admin mit gespeichertem Kader zählt",
  nurMitspieler(liga, new Set(["1", "2", "9"])).map((m) => m.n), ["Anna", "Bert", "Admin"]);
pruefe("leere Liste", nurMitspieler(null), []);

// Transfers sind das verlaesslichste Kennzeichen – auch ohne Teamwert.
pruefe("Admin mit Transfer im Feed zaehlt",
  nurMitspieler(liga, { namen: new Set(["Admin"]) }).map((m) => m.n), ["Anna", "Bert", "Admin"]);
pruefe("Admin ohne Transfer bleibt draussen",
  nurMitspieler(liga, { namen: new Set(["Anna"]) }).map((m) => m.n), ["Anna", "Bert"]);
pruefe("beide Mengen zusammen",
  nurMitspieler(liga, { ids: new Set(["9"]), namen: new Set() }).map((m) => m.n),
  ["Anna", "Bert", "Admin"]);

// Namensdoppel: Der Admin darf die Transfers eines gleichnamigen
// Mitspielers nicht erben.
console.log("\nZwei Manager mit demselben Namen:");
const doppelt = [
  { i: "1", n: "Fabinho", tv: 150e6 },
  { i: "2", n: "Anna", tv: 140e6 },
  { i: "9", n: "Fabinho", adm: true, tv: 0, sp: 0 },
];
pruefe("Admin erbt die Transfers NICHT",
  nurMitspieler(doppelt, { namen: new Set(["Fabinho"]) }).map((m) => m.i), ["1", "2"]);
pruefe("eindeutiger Name zaehlt weiterhin",
  nurMitspieler(liga, { namen: new Set(["Admin"]) }).map((m) => m.n), ["Anna", "Bert", "Admin"]);
pruefe("eigener Kader zaehlt auch bei doppeltem Namen",
  nurMitspieler(doppelt, { ids: new Set(["9"]), namen: new Set(["Fabinho"]) }).map((m) => m.i),
  ["1", "2", "9"]);
pruefe("eigener Teamwert zaehlt auch bei doppeltem Namen",
  nurMitspieler([...doppelt.slice(0, 2), { i: "9", n: "Fabinho", adm: true, tv: 90e6 }],
    { namen: new Set(["Fabinho"]) }).map((m) => m.i), ["1", "2", "9"]);

// Der Modus aus den Einstellungen sticht die Automatik.
console.log("\nEinstellung schlaegt Automatik:");
pruefe("immer zeigen holt den Admin rein",
  nurMitspieler(liga, null, "immer").map((m) => m.n), ["Anna", "Bert", "Admin"]);
pruefe("nie blendet ihn aus, auch wenn er spielt",
  nurMitspieler(ligaMitAdmin, null, "nie").map((m) => m.n), ["Anna", "Bert"]);
pruefe("auto bleibt die Automatik",
  nurMitspieler(ligaMitAdmin, null, "auto").map((m) => m.n), ["Anna", "Bert", "Admin"]);

console.log(fehler ? `\n${fehler} Fall/Fälle falsch` : "\nAlle Fälle richtig.");
process.exit(fehler ? 1 : 0);
