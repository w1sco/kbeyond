// Abgleich mit einem echten Kontostand: Welche Ursache passt genau?
import { loginVerlust, erklaereDifferenz, doppelteVerdacht, leseBetrag } from "../lib/abgleich.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};

// ── Was ein ausgelassener Login kostet ─────────────────────────────
// 20 Tage: Staffel 450.000 + 11 × 100.000 = 1,55 Mio.
pruefe("am letzten Tag: nur dieser Tag fehlt", loginVerlust(20, [20]), 100000);
pruefe("am ersten Tag: einen Tag hinter der Staffel", loginVerlust(20, [1]), 100000);
// Tag 11 fällt aus: 10 Tage (550 Tsd) + Neustart 9 Tage (450 Tsd) = 1,0 Mio
pruefe("mitten drin: Ausfall + Neustart", loginVerlust(20, [11]), 550000);
pruefe("symmetrisch: Tag 10 kostet wie Tag 11", loginVerlust(20, [10]), 550000);
pruefe("vorgestern: Neustart erst 1 Tag her", loginVerlust(20, [19]), 190000);
// 30 Tage: Formel 2,55 Mio; echt 4 Tage (100 Tsd) + 14 Tage (950 Tsd) + 10 Tage (550 Tsd)
pruefe("zwei Ausfälle", loginVerlust(30, [5, 20]), 950000);
pruefe("Tag außerhalb", loginVerlust(10, [11]), null);
pruefe("ohne Tage nichts", loginVerlust(0, [1]), 0);

// ── Erklärungen ────────────────────────────────────────────────────
const T = (kauf, preis, spieler = "X", quelle = "feed", dt = "2026-10-01T10:00:00Z") =>
  ({ kauf, preis, spieler, quelle, dt });
{
  const e = erklaereDifferenz({ diff: -550000, tage: 20 });
  pruefe("ein Login: eine Erklärung", e.length, 1);
  pruefe("ein Login: Art", e[0].teile[0].art, "login");
  pruefe("ein Login: beide möglichen Tage", e[0].teile[0].varianten, [[10], [11]]);
}
{
  // Ein doppelt gezählter Kauf: Die Rechnung liegt um den Preis zu tief.
  const e = erklaereDifferenz({ diff: 1746457, tage: 20, transfers: [T(true, 1746457, "Stalmach"), T(true, 900000)] });
  pruefe("Kauf zu viel gezählt", e.map((x) => x.teile[0].transfer?.spieler), ["Stalmach"]);
}
{
  const e = erklaereDifferenz({ diff: -1746457, tage: 0, transfers: [T(false, 1746457, "Stalmach")] });
  pruefe("Verkauf zu viel gezählt", e[0].teile[0].transfer.spieler, "Stalmach");
}
{
  // Login an Tag 19 (−190 Tsd) und ein doppelter Kauf (+1.746.457)
  const e = erklaereDifferenz({ diff: 1746457 - 190000, tage: 20, transfers: [T(true, 1746457, "Stalmach")] });
  pruefe("Paar: Login und Transfer", e.map((x) => x.teile.map((y) => y.art)), [["login", "transfer"]]);
  // Tag 2 kostet wie Tag 19 — die Staffel ist symmetrisch.
  pruefe("Paar: die Login-Tage", e[0].teile[0].varianten, [[2], [19]]);
}
{
  const e = erklaereDifferenz({ diff: -37000, tage: 0, proPunkt: 1000 });
  pruefe("Punkte-Bonus: 37 Punkte", e[0].teile[0].punkte, -37);
}
pruefe("krumme Differenz ohne Treffer", erklaereDifferenz({ diff: -4500972, tage: 20, transfers: [T(true, 1000000)], proPunkt: 1000 }), []);
{
  // Zwei Ausfälle nur, wenn einer nicht reicht.
  const e = erklaereDifferenz({ diff: -950000, tage: 30 });
  pruefe("zwei Ausfälle, wenn einer nicht reicht", e.map((x) => x.teile[0].ausfaelle), [2]);
}
pruefe("keine Differenz, nichts zu erklären", erklaereDifferenz({ diff: 0, tage: 20 }), []);

// ── Doppelt erfasst ────────────────────────────────────────────────
{
  const d = doppelteVerdacht([
    T(true, 2500000, "Höler", "feed", "2026-10-09T12:00:00Z"),
    T(true, 2500000, "Höler", "rk", "2026-10-09T11:59:00Z"),
    T(true, 2500000, "Höler", "rk", "2026-09-01T11:59:00Z"),
  ]);
  pruefe("doppelt: nur der zeitnahe Zwilling", d.length, 1);
}

// ── Betrag aus dem Screenshot ──────────────────────────────────────
pruefe("wie in der App", leseBetrag("€ -4.500.972"), -4500972);
pruefe("typografisches Minus", leseBetrag("−4.500.972 €"), -4500972);
pruefe("ohne Trenner", leseBetrag("-4500972"), -4500972);
pruefe("positiv", leseBetrag("1.746.457"), 1746457);
pruefe("mit Cent", leseBetrag("12,50"), 12.5);
pruefe("Unsinn", leseBetrag("vier Millionen"), null);
pruefe("falsch gruppiert", leseBetrag("4.50.972"), null);
pruefe("leer", leseBetrag("  "), null);

console.log(`abgleich: ${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
