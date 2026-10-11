// Abgleich mit einem echten Kontostand — woher kommt die Differenz?
//
// Den eigenen Kontostand prüft die Kalibrierung. Von Mitspielern kennt man
// ihn nur, wenn sie ihn zeigen — etwa per Screenshot. Dann lässt sich
// dieselbe Frage stellen: Stimmt die Rechnung, und wenn nicht, warum?
//
// Gesucht werden nur **genaue** Treffer. Kickbase-Preise sind krumme
// Beträge (1.746.457 €), eine Differenz, die auf den Euro zu einem
// bestimmten Transfer oder einem bestimmten ausgelassenen Login passt, ist
// deshalb ein starker Hinweis — eine, die nur ungefähr passt, ist keiner.
//
// Reine Rechnung, keine Datenbank.

import { loginBonus } from "./loginbonus.js";

// Was der Login-Bonus weniger bringt, wenn an den Tagen `ausfaelle`
// (1 = erste Mitternacht nach dem Startpunkt) nicht eingeloggt wurde.
// Danach beginnt die Staffel neu bei 10.000 €.
export function loginVerlust(tage, ausfaelle) {
  if (tage <= 0) return 0;
  const sortiert = [...ausfaelle].sort((a, b) => a - b);
  let echt = 0;
  let vorher = 0;
  for (const d of sortiert) {
    if (d < 1 || d > tage) return null;
    echt += loginBonus(d - vorher - 1);
    vorher = d;
  }
  echt += loginBonus(tage - vorher);
  return loginBonus(tage) - echt;
}

const GLEICH = (a, b) => Math.abs(a - b) < 0.5;

// `diff`:      echter Kontostand − berechneter (zum selben Zeitpunkt)
// `tage`:      gezählte Login-Tage bis zu diesem Zeitpunkt (0 = Login aus)
// `transfers`: [{ dt, kauf: bool, preis, spieler, quelle }] dieses Managers bis dahin
// `proPunkt`:  Punkte-Bonus je Punkt
//
// Ergebnis: Erklärungen, die genau passen — einzeln, dann paarweise.
export function erklaereDifferenz({ diff, tage = 0, transfers = [], proPunkt = 0 }) {
  if (diff == null || GLEICH(diff, 0)) return [];

  // Bausteine: jeder mit dem Betrag, um den er den echten Kontostand vom
  // berechneten abweichen ließe.
  const login = [];
  for (let d = 1; d <= tage; d++) {
    login.push({ art: "login", tage: [d], betrag: -loginVerlust(tage, [d]) });
  }
  const login2 = [];
  for (let a = 1; a <= tage; a++) {
    for (let b = a + 1; b <= tage; b++) {
      login2.push({ art: "login", tage: [a, b], betrag: -loginVerlust(tage, [a, b]) });
    }
  }
  // Ein Transfer, den die Rechnung zählt, den es so aber nicht gab (oder
  // doppelt): Ein gezählter Kauf drückt die Rechnung, also liegt der echte
  // Kontostand um den Preis darüber — beim Verkauf umgekehrt.
  const zuViel = transfers.map((t) => ({
    art: "transfer", transfer: t, betrag: t.kauf ? t.preis : -t.preis,
  }));

  const raus = [];
  const merke = (teile) => raus.push({ teile, betrag: teile.reduce((s, x) => s + x.betrag, 0) });

  // Ausgelassene Logins: Die Staffel ist symmetrisch, ein Ausfall an Tag 10
  // kostet so viel wie einer an Tag 11. Alle passenden Tage stehen deshalb
  // in **einer** Erklärung — welcher es war, weiß nur der Manager.
  const passendLogin = (liste) => liste.filter((x) => GLEICH(x.betrag, diff));
  // Zwei Ausfälle nur, wenn einer nicht reicht: Die einfachere Erklärung
  // gewinnt, sonst stünde neben jedem Treffer ein zweiter, gleich genauer.
  for (const [liste, anzahl] of [[login, 1], [login2, 2]]) {
    if (anzahl === 2 && raus.length > 0) break;
    const treffer = passendLogin(liste);
    if (treffer.length) {
      raus.push({
        teile: [{ art: "login", ausfaelle: anzahl, varianten: treffer.map((x) => x.tage), betrag: diff }],
        betrag: diff,
      });
    }
  }
  for (const x of zuViel) if (GLEICH(x.betrag, diff)) merke([x]);

  // Punkte-Bonus: die Differenz ist ein ganzes Vielfaches davon, in einem
  // Rahmen, der zu einem Spieltag passt.
  if (proPunkt > 0 && Number.isInteger(diff / proPunkt) && Math.abs(diff / proPunkt) <= 250) {
    merke([{ art: "punkte", punkte: diff / proPunkt, betrag: diff }]);
  }

  // Paare — nur, wenn kein einzelner Baustein passt: ein ausgelassener
  // Login und ein Transfer, oder zwei Transfers.
  if (raus.length === 0) {
    for (const y of zuViel) {
      const treffer = login.filter((x) => GLEICH(x.betrag + y.betrag, diff));
      if (treffer.length) {
        raus.push({
          teile: [{ art: "login", ausfaelle: 1, varianten: treffer.map((x) => x.tage), betrag: treffer[0].betrag }, y],
          betrag: diff,
        });
      }
    }
    for (let i = 0; i < zuViel.length; i++) for (let j = i + 1; j < zuViel.length; j++) {
      if (GLEICH(zuViel[i].betrag + zuViel[j].betrag, diff)) merke([zuViel[i], zuViel[j]]);
    }
  }

  return raus.slice(0, 12);
}

// Transfers, die vermutlich doppelt in der Rechnung stehen: derselbe
// Spieler zum selben Preis einmal aus dem Feed und einmal aus der
// Rekonstruktion, wenige Tage auseinander. Unabhängig von der Differenz —
// das ist ein Befund für sich.
export function doppelteVerdacht(transfers, tageAbstand = 3) {
  const feed = transfers.filter((t) => t.quelle === "feed");
  const rk = transfers.filter((t) => t.quelle === "rk");
  const raus = [];
  for (const r of rk) {
    const zwilling = feed.find((f) =>
      f.spieler === r.spieler && f.preis === r.preis && f.kauf === r.kauf &&
      Math.abs(new Date(f.dt) - new Date(r.dt)) <= tageAbstand * 86_400_000);
    if (zwilling) raus.push({ rk: r, feed: zwilling });
  }
  return raus;
}

// Ein Betrag, wie man ihn aus einem Screenshot abtippt: „€ -4.500.972“,
// „−4.500.972 €“ (typografisches Minus), „-4500972“. Punkte sind
// Tausendertrenner, ein Komma leitet Cent ein. Unlesbares ergibt null —
// lieber nachfragen als mit einer falschen Zahl abgleichen.
export function leseBetrag(text) {
  if (text == null) return null;
  let s = String(text).trim().replace(/[−–]/g, "-").replace(/[€\s]/g, "");
  if (!s) return null;
  const minus = s.startsWith("-");
  s = s.replace(/^[-+]/, "");
  const [ganz, cent = ""] = s.split(",");
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(ganz) || !/^\d{0,2}$/.test(cent)) return null;
  const wert = Number(ganz.replace(/\./g, "")) + (cent ? Number(cent.padEnd(2, "0")) / 100 : 0);
  return minus ? -wert : wert;
}
