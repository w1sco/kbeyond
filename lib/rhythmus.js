// Wann kommt ein Spieler wieder auf den Transfermarkt?
//
// **Alle 14 Tage.** Das war die Ausgangslage jeder Liga und hat sich als
// die Regel erwiesen — zumindest für die namhaften Spieler, um die es
// beim Kaufen geht. Ein Spieler, der am Markt erscheint und ungekauft
// abläuft, kommt zwei Wochen später wieder; einer, der an Kickbase
// zurückverkauft wird, ebenfalls zwei Wochen nach dem Verkauf.
//
// ── Die Schätzung gab es einmal ─────────────────────────────────────
//
// Hier stand eine Rechnung, die den Rhythmus laufend aus den beobachteten
// Abständen schätzte: Median der jüngsten Abstände, Ausreißer verworfen,
// Vielfache als Beobachtungslücke gedeutet, unter vier Abständen
// „unbekannt". Sie war korrekt gebaut und trotzdem im Weg — der
// gemessene Wert lag ohnehin bei 14, und jede Liga zeigte erst wochenlang
// „angenommen, noch nicht gemessen", bevor sie es bestätigen konnte.
// Eine Schätzung, die am Ende immer dasselbe ergibt, ist eine Zahl mit
// Umweg. Sie ist raus; der Rhythmus ist eine Konstante.
//
// ── Was beobachtet wird ──────────────────────────────────────────────
//
// Der **Anker**: das letzte Ereignis, das den Spieler wieder frei gemacht
// hat. Entscheidend ist dabei das *Erscheinen* am Markt und nicht der
// Kauf. Ein Spieler kann auf den Markt kommen, ungekauft ablaufen und 14
// Tage später wiederkommen und dann gekauft werden — zwischen den beiden
// Käufen lägen 28 Tage, der Rhythmus ist aber 14. Der Feed liefert dafür
// Typ 3 („Spieler neu am Markt"), also das Erscheinen selbst.
//
// Drei Quellen, alle in derselben Zeitreihe:
//   1. Feed-Events Typ 3      — das Erscheinen, die beste Quelle
//   2. Käufe von Kickbase      — wer gekauft wurde, war vorher am Markt
//   3. Der Live-Markt          — wer gerade dort steht
//
// Alles vor dem Stichtag bleibt draußen: Die Historie vor dem Liga-Reset
// sagt über das Heute nichts.
//
// Reine Rechnung, keine Datenbank.

// Der Rhythmus. Eine Konstante, keine Annahme — siehe oben.
export const ZYKLUS_TAGE = 14;

// Beobachtungen, die dichter beieinanderliegen, gehören zum selben
// Auftritt: ein Angebot steht rund einen Tag, und Erscheinen und Kauf
// desselben Angebots dürfen nicht als zwei Auftritte zählen.
export const AUFTRITT_FENSTER_H = 36;

// Ab so vielen Tagen über dem Termin gilt ein Spieler als überfällig. Ein
// Tag Spiel ist drin: Kickbase stellt nicht auf die Minute pünktlich ein.
export const KULANZ_TAGE = 1;

const TAG_MS = 86_400_000;

// Beobachtungen eines Spielers zu Auftritten zusammenfassen.
export function bildeAuftritte(zeitpunkte, fensterH = AUFTRITT_FENSTER_H) {
  const sortiert = [...zeitpunkte]
    .map((z) => (z instanceof Date ? z : new Date(z)))
    .filter((z) => !isNaN(z))
    .sort((a, b) => a - b);

  const auftritte = [];
  for (const z of sortiert) {
    const letzter = auftritte[auftritte.length - 1];
    if (letzter && z - letzter <= fensterH * 3_600_000) continue;
    auftritte.push(z);
  }
  return auftritte;
}

// Prognose für einen einzelnen Spieler.
//
// Verankert wird am letzten Ereignis, das den Spieler wieder frei gemacht
// hat: sein letzter Auftritt am Markt (er lief ungekauft ab) oder sein
// Verkauf an Kickbase — je nachdem, was später war.
//
// Der Verkauf zählt mit, weil er die Uhr neu setzt: Ein Spieler, der
// gekauft und wieder verkauft wurde, geht zurück in den Pool und kommt von
// dort nach dem Rhythmus wieder. Ohne diesen Anker stand bei genau diesen
// Spielern „unbekannt", obwohl sich der Termin direkt ausrechnen lässt.
export function prognostiziere({
  auftritte = [],
  verkauftAm = null,
  jetzt = new Date(),
  aufMarktBis = null,
}) {
  if (aufMarktBis) {
    return { lage: "aufMarkt", bis: aufMarktBis };
  }

  const letzterAuftritt = auftritte[auftritte.length - 1] ?? null;
  const anker = [letzterAuftritt, verkauftAm]
    .filter(Boolean)
    .sort((a, b) => b - a)[0] ?? null;

  if (!anker) {
    // Seit dem Reset weder am Markt gewesen noch verkauft worden. Die
    // kommen in den nächsten Tagen, aber nicht nach einem Rhythmus — der
    // erste Auftritt nach einem Reset folgt keinem festen Abstand.
    return { lage: "nieDagewesen" };
  }

  const naechster = new Date(anker.getTime() + ZYKLUS_TAGE * TAG_MS);
  const tageHin = (naechster - jetzt) / TAG_MS;
  const durchVerkauf = verkauftAm != null && anker.getTime() === verkauftAm.getTime();

  // Wer mehrfach beobachtet wurde, hat den Rhythmus schon einmal
  // bestätigt. Ein einzelner Anker kann auch ein Fremdangebot sein, das
  // durch die Filter gerutscht ist — dann steht „ca." dabei.
  const sicherheit = auftritte.length >= 2 ? "gut" : "grob";

  if (tageHin < -KULANZ_TAGE) {
    return { lage: "ueberfaellig", anker, naechster, tageHin, sicherheit, durchVerkauf };
  }
  return { lage: "erwartet", anker, naechster, tageHin, sicherheit, durchVerkauf };
}
