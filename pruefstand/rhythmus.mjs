// Wann kommt ein Spieler wieder? Reine Rechnung, kein Server nötig.
//
// Der Rhythmus ist eine Konstante (14 Tage). Geprüft wird deshalb nicht
// eine Schätzung, sondern der Anker: woran hängt der Termin, und was
// passiert an den Rändern.
import { bildeAuftritte, prognostiziere, ZYKLUS_TAGE, KULANZ_TAGE } from "../lib/rhythmus.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};
const T = (s) => new Date(s);
const tage = (n) => n * 86_400_000;
const jetzt = T("2026-09-13T12:00:00Z");

pruefe("der Rhythmus ist 14 Tage", ZYKLUS_TAGE, 14);

// ── Auftritte bündeln ──────────────────────────────────────────────
// Erscheinen und Kauf desselben Angebots sind EIN Auftritt.
pruefe("Erscheinen + Kauf am nächsten Tag = ein Auftritt",
  bildeAuftritte([T("2026-09-01T10:00Z"), T("2026-09-02T09:00Z")]).length, 1);
pruefe("zwei Wochen später = zweiter Auftritt",
  bildeAuftritte([T("2026-09-01T10:00Z"), T("2026-09-15T10:00Z")]).length, 2);
pruefe("unsortiert und mit Müll",
  bildeAuftritte(["2026-09-15T10:00Z", "kaputt", T("2026-09-01T10:00Z")]).length, 2);

// ── Der Anker ──────────────────────────────────────────────────────
const auftritt = [T("2026-09-05T10:00Z")];   // vor 8 Tagen

const p1 = prognostiziere({ auftritte: auftritt, jetzt });
pruefe("erwartet: 14 Tage nach dem Auftritt", p1.lage, "erwartet");
pruefe("Termin = Auftritt + 14", p1.naechster.getTime(), auftritt[0].getTime() + tage(14));
pruefe("noch 6 Tage hin", Math.round(p1.tageHin), 6);
pruefe("einmal gesehen = grob", p1.sicherheit, "grob");
pruefe("nicht durch Verkauf", p1.durchVerkauf, false);

// Ein Verkauf setzt die Uhr neu — er sticht einen älteren Auftritt.
const p2 = prognostiziere({ auftritte: auftritt, verkauftAm: T("2026-09-10T18:00Z"), jetzt });
pruefe("Verkauf nach dem Auftritt ist der Anker",
  p2.naechster.getTime(), T("2026-09-10T18:00Z").getTime() + tage(14));
pruefe("und heißt so", p2.durchVerkauf, true);

// … aber ein älterer Verkauf sticht den jüngeren Auftritt nicht.
const p3 = prognostiziere({ auftritte: auftritt, verkauftAm: T("2026-08-20T18:00Z"), jetzt });
pruefe("jüngerer Auftritt gewinnt", p3.anker.getTime(), auftritt[0].getTime());
pruefe("dann nicht durch Verkauf", p3.durchVerkauf, false);

// Wer zweimal da war, hat den Rhythmus bestätigt.
const p4 = prognostiziere({ auftritte: [T("2026-08-22T10:00Z"), T("2026-09-05T10:00Z")], jetzt });
pruefe("zweimal gesehen = gut", p4.sicherheit, "gut");

// ── Die Ränder ─────────────────────────────────────────────────────
// Am Termin selbst: erwartet, 0 Tage hin.
const p5 = prognostiziere({ auftritte: [new Date(jetzt.getTime() - tage(14))], jetzt });
pruefe("genau am Termin: erwartet", p5.lage, "erwartet");
pruefe("… mit 0 Tagen", Math.round(p5.tageHin), 0);

// Einen Tag drüber: noch nicht überfällig — die Kulanz.
const p6 = prognostiziere({ auftritte: [new Date(jetzt.getTime() - tage(14 + KULANZ_TAGE))], jetzt });
pruefe("Kulanztag: noch erwartet", p6.lage, "erwartet");

// Danach: überfällig, kann jederzeit kommen.
const p7 = prognostiziere({ auftritte: [new Date(jetzt.getTime() - tage(16))], jetzt });
pruefe("16 Tage: überfällig", p7.lage, "ueberfaellig");
pruefe("… und sagt seit wann", Math.round(p7.tageHin), -2);

// ── Sonderlagen ────────────────────────────────────────────────────
pruefe("steht gerade am Markt",
  prognostiziere({ auftritte: auftritt, jetzt, aufMarktBis: T("2026-09-14T10:00Z") }).lage, "aufMarkt");
pruefe("seit dem Reset nie gesehen",
  prognostiziere({ auftritte: [], jetzt }).lage, "nieDagewesen");
pruefe("ohne Angaben: nie gesehen, kein Absturz",
  prognostiziere({ jetzt }).lage, "nieDagewesen");

console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
