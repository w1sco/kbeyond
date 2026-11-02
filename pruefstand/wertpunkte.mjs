// Wert und Punkte: Gerade, Verhältnis, Abstand, Pfade. Reine Rechnung.
import { trendlinie, werteAus, pfade } from "../lib/wertpunkte.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};
const rund = (x) => (x == null ? null : Math.round(x));

// ── Die Gerade ─────────────────────────────────────────────────────
// Genau auf einer Geraden: 200 Mio Start + 100.000 € je Punkt.
const exakt = [{ x: 0, y: 200e6 }, { x: 500, y: 250e6 }, { x: 1000, y: 300e6 }];
pruefe("Achsenabschnitt = Startbudget", rund(trendlinie(exakt).a), 200e6);
pruefe("Steigung = Wert je Punkt", rund(trendlinie(exakt).b), 100000);
pruefe("unter drei Managern keine Gerade", trendlinie(exakt.slice(0, 2)), null);
pruefe("alle gleich viele Punkte: keine Gerade", trendlinie([{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }]), null);
pruefe("unsinnige Werte fallen raus", trendlinie([...exakt, { x: NaN, y: 5 }]) != null, true);

// ── Kennzahlen je Manager ──────────────────────────────────────────
{
  const { zeilen, trend, gezaehlt } = werteAus([
    { id: 1, name: "A", punkte: 500, gesamt: 250e6 },
    { id: 2, name: "B", punkte: 1000, gesamt: 300e6 },
    { id: 3, name: "C", punkte: 0, gesamt: 200e6 },
    // Liegt 30 Mio über der Geraden der anderen — zieht sie aber mit.
    { id: 4, name: "D", punkte: 500, gesamt: 280e6 },
    { id: 5, name: "E", punkte: 700, gesamt: null },   // verbirgt seine Zahlen
  ]);
  pruefe("verborgen zählt nicht in die Gerade", gezaehlt, 4);
  pruefe("Mio je Punkt", rund(zeilen[0].mioJePunkt), 500000);
  pruefe("ohne Punkte kein Verhältnis", zeilen[2].mioJePunkt, null);
  pruefe("verborgen: keine Kennzahlen", [zeilen[4].mioJePunkt, zeilen[4].abstand], [null, null]);
  pruefe("verborgen bleibt in der Liste", zeilen.length, 5);
  pruefe("über der Geraden: positiver Abstand", zeilen[3].abstand > 0, true);
  pruefe("Abstände summieren sich zu null", rund(zeilen.slice(0, 4).reduce((s, z) => s + z.abstand, 0)), 0);
  pruefe("Gerade vorhanden", trend != null, true);
}
pruefe("zu wenige Manager: keine Abstände",
  werteAus([{ id: 1, punkte: 10, gesamt: 1 }, { id: 2, punkte: 20, gesamt: 2 }]).zeilen.map((z) => z.abstand), [null, null]);
pruefe("Zahlen als Text (NUMERIC)", rund(werteAus([{ id: 1, punkte: "400", gesamt: "200000000" }]).zeilen[0].mioJePunkt), 500000);

// ── Pfade ──────────────────────────────────────────────────────────
{
  const p = pfade([
    { managerId: 1, tag: "2026-10-02", teamwert: 100, konto: 50, punkte: 20 },
    { managerId: 1, tag: "2026-10-01", teamwert: 90, konto: 50, punkte: 10 },
    { managerId: 1, tag: "2026-10-03", teamwert: 95, konto: null, punkte: 30 },  // verborgen/unbekannt
    { managerId: 2, tag: "2026-10-01", teamwert: 80, konto: 40, punkte: null },  // Punkte unbekannt
  ]);
  pruefe("Pfad: nach Tag sortiert, nur wo alles bekannt", p.get("1"), [
    { tag: "2026-10-01", punkte: 10, gesamt: 140 }, { tag: "2026-10-02", punkte: 20, gesamt: 150 }]);
  pruefe("Pfad: ohne Punkte kein Punkt", p.has("2"), false);
  pruefe("Pfad: Datum als Date", pfade([{ managerId: 3, tag: new Date("2026-10-05T00:00:00Z"), teamwert: 1, konto: 1, punkte: 1 }]).get("3")[0].tag, "2026-10-05");
}

console.log(`wertpunkte: ${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
