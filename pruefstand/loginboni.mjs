// Kommende Login-Boni bis zum ersten Spiel des Spieltags.
import { loginBonus, tagesBonus, kommendeLoginBoni } from "../lib/loginbonus.js";

const eur = (n) => n.toLocaleString("de-DE") + " €";
let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(46)} ${typeof ist === "number" ? eur(ist) : JSON.stringify(ist)}${ok ? "" : `  (erwartet ${typeof soll === "number" ? eur(soll) : JSON.stringify(soll)})`}`);
};

console.log("Tagesbonus folgt der Staffelung:");
pruefe("Tag 1", tagesBonus(1), 10_000);
pruefe("Tag 5", tagesBonus(5), 50_000);
pruefe("Tag 9", tagesBonus(9), 90_000);
pruefe("Tag 10 (ab hier konstant)", tagesBonus(10), 100_000);
pruefe("Tag 40", tagesBonus(40), 100_000);
pruefe("Summe der Tagesboni 1..9 = loginBonus(9)",
  [1,2,3,4,5,6,7,8,9].reduce((a,t)=>a+tagesBonus(t),0), loginBonus(9));

// Ein Mittwoch (2026-08-26) und ein Freitag (2026-08-28), je 12:00 deutscher Zeit
const mi = new Date("2026-08-26T10:00:00Z");
const fr = new Date("2026-08-28T10:00:00Z");
const sa = new Date("2026-08-29T10:00:00Z");
// Referenz weit zurück → im konstanten Bereich (100 Tsd/Nacht)
const alt = new Date("2026-01-01T00:00:00Z");

console.log("\nNächte bis zum Anpfiff (Referenz alt, also 100 Tsd je Nacht):");
pruefe("Mittwoch → Freitag: 2 Nächte", kommendeLoginBoni({referenz: alt, spieltagStart:"fr", jetzt: mi}).betrag, 200_000);
pruefe("Mittwoch → Samstag: 3 Nächte", kommendeLoginBoni({referenz: alt, spieltagStart:"sa", jetzt: mi}).betrag, 300_000);
pruefe("Mittwoch → Dienstag: 6 Nächte", kommendeLoginBoni({referenz: alt, spieltagStart:"di", jetzt: mi}).betrag, 600_000);
pruefe("Freitag → Freitag: heute, also 0", kommendeLoginBoni({referenz: alt, spieltagStart:"fr", jetzt: fr}).betrag, 0);
pruefe("Samstag → Freitag: 6 Nächte", kommendeLoginBoni({referenz: alt, spieltagStart:"fr", jetzt: sa}).betrag, 600_000);
pruefe("Login-Bonus aus: 0", kommendeLoginBoni({referenz: alt, spieltagStart:"fr", jetzt: mi, aktiv:false}).betrag, 0);
pruefe("ohne Referenz: 0", kommendeLoginBoni({referenz: null, spieltagStart:"fr", jetzt: mi}).betrag, 0);

// Junge Liga: Referenz so, dass heute Tag 3 ist → die nächsten Nächte sind 4 und 5
const jung = new Date("2026-08-23T00:00:00Z");   // Mi 26.08. ist Tag 3
console.log("\nJunge Liga (heute Tag 3, Staffelung noch am Steigen):");
const r = kommendeLoginBoni({referenz: jung, spieltagStart:"fr", jetzt: mi});
pruefe("Mittwoch → Freitag: Tag 4 + Tag 5", r.betrag, 40_000 + 50_000);
pruefe("Posten benannt", r.posten.map(p=>p.tag), [4,5]);

// Grenze zwischen Staffelung und Konstante
const grenze = new Date("2026-08-19T00:00:00Z");  // Mi 26.08. ist Tag 7
console.log("\nÜber die Grenze von Tag 9 auf 10 (Dienstag als Spieltag):");
const g = kommendeLoginBoni({referenz: grenze, spieltagStart:"di", jetzt: mi});
pruefe("Tage 8,9,10,11,12,13", g.posten.map(p=>p.tag), [8,9,10,11,12,13]);
pruefe("80+90+100+100+100+100 Tsd", g.betrag, (80+90+100+100+100+100)*1000);

console.log(fehler ? `\n${fehler} Fall/Fälle falsch` : "\nAlle Fälle richtig.");
process.exit(fehler ? 1 : 0);
