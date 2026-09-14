// Wann kommt ein Spieler wieder? Reine Rechnung, kein Server nötig.
//
// Der Rhythmus ist eine Konstante (14 Tage). Geprüft wird deshalb nicht
// eine Schätzung, sondern der Anker: woran hängt der Termin, und was
// passiert an den Rändern.
import { bildeAuftritte, prognostiziere, vorAnpfiff, naechsterWochentagText, ZYKLUS_TAGE, KULANZ_TAGE } from "../lib/rhythmus.js";

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

// ── Der Regler ─────────────────────────────────────────────────────
// Ein anderer Abstand verschiebt den Termin — und nur den.
const p8 = prognostiziere({ auftritte: auftritt, jetzt, zyklusTage: 7 });
pruefe("7 Tage: Termin = Auftritt + 7", p8.naechster.getTime(), auftritt[0].getTime() + tage(7));
pruefe("7 Tage: damit schon überfällig", p8.lage, "ueberfaellig");
const p9 = prognostiziere({ auftritte: auftritt, jetzt, zyklusTage: 21 });
pruefe("21 Tage: noch 13 hin", Math.round(p9.tageHin), 13);

// Über die Server-Grenze kommen Zeitpunkte als Zahlen an — die Rechnung
// läuft im Browser und darf daran nicht scheitern.
const p10 = prognostiziere({
  auftritte: [auftritt[0].getTime()], verkauftAm: T("2026-09-10T18:00Z").getTime(),
  jetzt: jetzt.getTime(),
});
pruefe("Zahlen statt Daten: gleicher Anker", p10.anker.getTime(), T("2026-09-10T18:00Z").getTime());
pruefe("Zahlen statt Daten: gleiche Lage", p10.lage, "erwartet");
pruefe("Text statt Daten geht auch",
  prognostiziere({ auftritte: ["2026-09-05T10:00Z"], jetzt: "2026-09-13T12:00:00Z" }).naechster.getTime(),
  auftritt[0].getTime() + tage(14));
pruefe("Müll als Anker: nie dagewesen statt Absturz",
  prognostiziere({ auftritte: ["kaputt"], verkauftAm: "auch kaputt", jetzt }).lage, "nieDagewesen");

// ── Läuft er noch vor dem Anpfiff aus? ─────────────────────────────
{
  const pr = pruefe;
  const jetzt2 = T("2026-09-14T10:00:00Z");
  const anpfiff = T("2026-09-18T18:30:00Z"); // Freitag 20:30 Berlin

  // Erwartet am 15.9. → läuft am 16.9. aus → mit einem Tag Spielraum vor Fr.
  const bald = prognostiziere({ auftritte: [T("2026-09-01T10:00Z")], jetzt: jetzt2 });
  pr("sicher: Ablauf zwei Tage vor Anpfiff", vorAnpfiff(bald, anpfiff, { jetzt: jetzt2 }).lage, "sicher");
  pr("… mit dem Ablaufzeitpunkt", vorAnpfiff(bald, anpfiff, { jetzt: jetzt2 }).ablauf.getTime(),
    T("2026-09-15T10:00Z").getTime() + tage(1));

  // Erwartet am 17.9. 10:00 → Ablauf 18.9. 10:00 → im Spielraum: vielleicht
  const knapp = prognostiziere({ auftritte: [T("2026-09-03T10:00Z")], jetzt: jetzt2 });
  pr("vielleicht: Ablauf am Anpfifftag", vorAnpfiff(knapp, anpfiff, { jetzt: jetzt2 }).lage, "vielleicht");

  // Erwartet am 20.9. → Ablauf 21.9. → klar danach
  const spaet = prognostiziere({ auftritte: [T("2026-09-06T10:00Z")], jetzt: jetzt2 });
  pr("nein: Ablauf drei Tage nach Anpfiff", vorAnpfiff(spaet, anpfiff, { jetzt: jetzt2 }).lage, "nein");

  // Der Regler verschiebt das Urteil mit.
  pr("mit 7 Tagen wird aus nein sicher",
    vorAnpfiff(prognostiziere({ auftritte: [T("2026-09-06T10:00Z")], jetzt: jetzt2, zyklusTage: 7 }),
               anpfiff, { jetzt: jetzt2 }).lage, "sicher");

  // Steht gerade am Markt: die Uhr entscheidet, kein Spielraum.
  pr("am Markt, läuft vorher ab: sicher",
    vorAnpfiff({ lage: "aufMarkt", bis: T("2026-09-15T12:00Z") }, anpfiff).lage, "sicher");
  pr("am Markt, läuft eine Minute danach ab: nein",
    vorAnpfiff({ lage: "aufMarkt", bis: T("2026-09-18T18:31:00Z") }, anpfiff).lage, "nein");

  // Überfällig: kann jeden Tag kommen.
  const ueber = prognostiziere({ auftritte: [T("2026-08-20T10:00Z")], jetzt: jetzt2 });
  pr("überfällig, Anpfiff in vier Tagen: vielleicht", vorAnpfiff(ueber, anpfiff, { jetzt: jetzt2 }).lage, "vielleicht");
  pr("überfällig, Anpfiff in zwölf Stunden: nein — selbst jetzt reicht es nicht",
    vorAnpfiff(ueber, T("2026-09-14T22:00:00Z"), { jetzt: jetzt2 }).lage, "nein");

  // Keine Aussage, wo keine möglich ist.
  pr("nie dagewesen: keine Aussage", vorAnpfiff({ lage: "nieDagewesen" }, anpfiff).lage, null);
  pr("ohne Anpfiff: keine Aussage", vorAnpfiff(bald, null).lage, null);
  pr("ohne Prognose: keine Aussage", vorAnpfiff(null, anpfiff).lage, null);
  pr("Anpfiff als Zahl geht auch", vorAnpfiff(bald, anpfiff.getTime(), { jetzt: jetzt2 }).lage, "sicher");

  // Der Ersatz, wenn der Spielplan schweigt: nächster Freitag 20:30.
  pr("Montag → kommender Freitag", naechsterWochentagText("2026-09-14T10:00", 1, 5), "2026-09-18T20:30");
  pr("Freitag 19:00 → heute", naechsterWochentagText("2026-09-18T19:00", 5, 5), "2026-09-18T20:30");
  pr("Freitag 21:00 → nächste Woche", naechsterWochentagText("2026-09-18T21:00", 5, 5), "2026-09-25T20:30");
  pr("Samstag als Spieltag", naechsterWochentagText("2026-09-14T10:00", 1, 6, "15:30"), "2026-09-19T15:30");

}

console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
