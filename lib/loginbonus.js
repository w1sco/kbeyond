// Der Login-Bonus – reine Rechnung, ohne Datenbank.
//
// Getrennt von ledger.js, damit sich das hier ohne Postgres durchrechnen
// lässt (pruefstand/loginboni.mjs). ledger.js zieht `sql` herein und ist
// damit für einen nackten Node-Lauf unerreichbar.
import { tageSeit, wochentag } from "./format.js";

export function loginBonus(tage) {
  if (tage <= 0) return 0;
  if (tage < 10) return (tage * (tage + 1)) / 2 * 10_000;
  return 450_000 + (tage - 9) * 100_000;
}

// Was der einzelne Tag bringt — die Differenz zweier Summen.
export function tagesBonus(tag) {
  return loginBonus(tag) - loginBonus(tag - 1);
}

// ── Was bis zum Anpfiff noch dazukommt ──────────────────────────────
//
// Der Login-Bonus wird um 0:00 Uhr gutgeschrieben. Bis zum ersten Spiel
// des Spieltags fallen also genau so viele Gutschriften an, wie
// Mitternachte dazwischen liegen. Für die Rechner ist das echtes Geld:
// Wer am Mittwoch überlegt zu kaufen, hat bis Freitag zwei Gutschriften
// mehr auf dem Konto.
//
// Ist heute schon der Spieltag, kommt nichts mehr — die Gutschrift von
// heute Nacht ist bereits im Kontostand enthalten. Das ist die
// vorsichtige Lesart: Sie verspricht nie Geld, das noch nicht da ist.
export const SPIELTAGE = [
  { schluessel: "fr", label: "Freitag",  tag: 5 },
  { schluessel: "sa", label: "Samstag",  tag: 6 },
  { schluessel: "di", label: "Dienstag", tag: 2 },
];

export function spieltagWahl(schluessel) {
  return SPIELTAGE.find((s) => s.schluessel === schluessel) ?? SPIELTAGE[0];
}

export function kommendeLoginBoni({ referenz, spieltagStart = "fr", aktiv = true, jetzt = new Date() }) {
  const wahl = spieltagWahl(spieltagStart);
  const heute = wochentag(jetzt);
  if (heute == null || !referenz) return { betrag: 0, naechte: 0, wahl, posten: [] };

  const naechte = (wahl.tag - heute + 7) % 7;
  if (!aktiv || naechte === 0) return { betrag: 0, naechte: 0, wahl, posten: [] };

  const bisher = tageSeit(referenz, jetzt);
  const posten = [];
  let betrag = 0;
  for (let i = 1; i <= naechte; i++) {
    const wert = tagesBonus(bisher + i);
    posten.push({ tag: bisher + i, betrag: wert });
    betrag += wert;
  }
  return { betrag, naechte, wahl, posten };
}
