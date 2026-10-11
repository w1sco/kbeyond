// Punkte-Bonus: erst nach dem Spieltag auf dem Konto.
import { offenerSpieltag, offenePunkte } from "../lib/punktebonus.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};

// Spieltag 7: Fr 16.10. 20:30, Sa 15:30, So 19:30 (Sommerzeit, UTC+2).
// Spieltag 8: Fr 23.10. 20:30.
const SPIELE = [
  { spieltag: 7, datum: "2026-10-16T18:30:00Z" },
  { spieltag: 7, datum: "2026-10-17T13:30:00Z" },
  { spieltag: 7, datum: "2026-10-18T17:30:00Z" },
  { spieltag: 8, datum: "2026-10-23T18:30:00Z" },
];
const offen = (zeit) => offenerSpieltag(SPIELE, new Date(zeit))?.spieltag ?? null;

pruefe("Donnerstag davor: nichts offen", offen("2026-10-15T12:00:00Z"), null);
pruefe("Freitag vor dem Anpfiff: nichts offen", offen("2026-10-16T18:00:00Z"), null);
pruefe("Freitag nach dem Anpfiff: Spieltag 7 offen", offen("2026-10-16T19:00:00Z"), 7);
pruefe("Sonntagnacht: noch offen", offen("2026-10-18T22:00:00Z"), 7);
pruefe("Montag 19:59: noch offen", offen("2026-10-19T17:59:00Z"), 7);
pruefe("Montag 20:00: ausgezahlt", offen("2026-10-19T18:00:00Z"), null);
pruefe("Mittwoch: ausgezahlt", offen("2026-10-21T12:00:00Z"), null);
pruefe("Auszahlungszeitpunkt", offenerSpieltag(SPIELE, new Date("2026-10-17T12:00:00Z")).auszahlung.toISOString(),
  "2026-10-19T18:00:00.000Z");
pruefe("ohne Spielplan: nichts offen", offenerSpieltag([], new Date()), null);
// Winterzeit: Spieltag endet So 1.11., Auszahlung Mo 2.11. 20:00 MEZ = 19:00 UTC
pruefe("Winterzeit: Auszahlung 19:00 UTC",
  offenerSpieltag([{ spieltag: 9, datum: "2026-11-01T16:30:00Z" }], new Date("2026-11-01T18:00:00Z")).auszahlung.toISOString(),
  "2026-11-02T19:00:00.000Z");

// ── Wie viele Punkte stehen aus ────────────────────────────────────
const o = { spieltag: 7 };
pruefe("mdp aus der Rangliste", offenePunkte({ offen: o, mdp: 63, sp: 511 }), 63);
pruefe("mdp 0 ist eine Angabe", offenePunkte({ offen: o, mdp: 0, sp: 511 }), 0);
pruefe("negative Spieltagspunkte", offenePunkte({ offen: o, mdp: -12, sp: 436 }), -12);
pruefe("ohne mdp: eigene Messung vorher", offenePunkte({ offen: o, sp: 511, punkteVorher: 448 }), 63);
pruefe("weder noch: unbekannt", offenePunkte({ offen: o, sp: 511 }), null);
pruefe("kein offener Spieltag: nichts aus", offenePunkte({ offen: null, mdp: 63, sp: 511 }), 0);

console.log(`punktebonus: ${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
