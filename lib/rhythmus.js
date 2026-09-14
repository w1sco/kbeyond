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

// Der Rhythmus, wie er heute gilt. Vorgabe — auf der Marktseite steht ein
// Regler, mit dem sich der Wert anpassen lässt, falls Kickbase ihn
// verschiebt. Der Regler ändert die Rechnung, nicht diese Zahl.
export const ZYKLUS_TAGE = 14;
export const ZYKLUS_BEREICH = [1, 30];

// Beobachtungen, die dichter beieinanderliegen, gehören zum selben
// Auftritt: ein Angebot steht rund einen Tag, und Erscheinen und Kauf
// desselben Angebots dürfen nicht als zwei Auftritte zählen.
export const AUFTRITT_FENSTER_H = 36;

// Ab so vielen Tagen über dem Termin gilt ein Spieler als überfällig. Ein
// Tag Spiel ist drin: Kickbase stellt nicht auf die Minute pünktlich ein.
export const KULANZ_TAGE = 1;

// Wie lange ein Angebot von Kickbase steht, bevor es ausläuft. Rund ein
// Tag — dieselbe Beobachtung, aus der auch das Auftrittsfenster kommt.
export const ANGEBOT_DAUER_H = 24;

// Wie scharf die Prognose ist: Der Anker ist ein Zeitpunkt, der Abstand
// eine ganze Zahl Tage — genauer als auf einen Tag wird es nicht. Liegt der
// Anpfiff innerhalb dieses Spielraums um den Ablauf, ist es „vielleicht".
export const SPIELRAUM_TAGE = 1;

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
//
// Läuft auch im Browser: Die Marktseite reicht die Anker je Spieler
// durch, und der Regler rechnet damit neu. Über die Server-Grenze kommen
// Zeitpunkte als Zahlen oder Text an — deshalb werden alle Eingaben hier
// erst zu Daten gemacht, statt darauf zu vertrauen.
const alsDatum = (x) => {
  if (x == null) return null;
  const d = x instanceof Date ? x : new Date(x);
  return isNaN(d) ? null : d;
};

export function prognostiziere({
  auftritte = [],
  verkauftAm = null,
  jetzt = new Date(),
  aufMarktBis = null,
  zyklusTage = ZYKLUS_TAGE,
}) {
  if (aufMarktBis) {
    return { lage: "aufMarkt", bis: aufMarktBis };
  }
  jetzt = alsDatum(jetzt) ?? new Date();
  verkauftAm = alsDatum(verkauftAm);
  auftritte = auftritte.map(alsDatum).filter(Boolean);

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

  const naechster = new Date(anker.getTime() + zyklusTage * TAG_MS);
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

// ── Läuft er noch vor dem Anpfiff aus? ───────────────────────────────
//
// Wer einen Spieler am Wochenende aufstellen will, braucht ihn vorher: Das
// Angebot muss **abgelaufen** sein, bevor der Spieltag anpfeift. Ablauf =
// Erscheinen + ANGEBOT_DAUER_H. Drei Aussagen, und eine vierte, die keine
// ist:
//
//   sicher      Ablauf liegt mit Spielraum vor dem Anpfiff
//   vielleicht  Ablauf liegt im Spielraum um den Anpfiff — oder der Spieler
//               ist überfällig und kann jeden Tag kommen
//   nein        Ablauf liegt mit Spielraum nach dem Anpfiff — oder ein
//               überfälliger Spieler könnte selbst ab jetzt nicht mehr
//               rechtzeitig auslaufen
//   null        keine Aussage: nie dagewesen, oder kein Anpfiff bekannt
//
// Steht er **gerade** am Markt, ist der Ablauf bekannt — dann gibt es kein
// „vielleicht", sondern nur die Uhr.
export function vorAnpfiff(prognose, anpfiff, { jetzt = new Date() } = {}) {
  const ziel = alsDatum(anpfiff);
  jetzt = alsDatum(jetzt) ?? new Date();
  if (!ziel || !prognose) return { lage: null, ablauf: null };

  const dauer = ANGEBOT_DAUER_H * 3_600_000;
  const spielraum = SPIELRAUM_TAGE * TAG_MS;

  if (prognose.lage === "aufMarkt") {
    const ablauf = alsDatum(prognose.bis);
    if (!ablauf) return { lage: null, ablauf: null };
    return { lage: ablauf < ziel ? "sicher" : "nein", ablauf };
  }

  if (prognose.lage === "ueberfaellig") {
    // Frühestmöglich: er erscheint jetzt und läuft in einem Tag aus.
    const fruehestens = new Date(jetzt.getTime() + dauer);
    return { lage: fruehestens < ziel ? "vielleicht" : "nein", ablauf: null };
  }

  if (prognose.lage === "erwartet") {
    const naechster = alsDatum(prognose.naechster);
    if (!naechster) return { lage: null, ablauf: null };
    const ablauf = new Date(naechster.getTime() + dauer);
    if (ablauf.getTime() + spielraum < ziel.getTime()) return { lage: "sicher", ablauf };
    if (ablauf.getTime() - spielraum > ziel.getTime()) return { lage: "nein", ablauf };
    return { lage: "vielleicht", ablauf };
  }

  return { lage: null, ablauf: null };
}

// Der nächste Spieltagsbeginn, wenn der Spielplan ihn nicht kennt: der
// nächste gewählte Wochentag (Einstellung, Vorgabe Freitag) zur gegebenen
// Uhrzeit — als Text in deutscher Ortszeit, den `ausEingabe()` liest.
// Ist es heute schon nach dieser Uhrzeit, gilt die nächste Woche.
export function naechsterWochentagText(jetztBerlinTeile, wochentagHeute, zielTag, uhrzeit = "20:30") {
  const [jahr, monat, tag] = jetztBerlinTeile.slice(0, 10).split("-").map(Number);
  const jetztUhr = jetztBerlinTeile.slice(11, 16);
  let vor = (zielTag - wochentagHeute + 7) % 7;
  if (vor === 0 && jetztUhr >= uhrzeit) vor = 7;
  const d = new Date(Date.UTC(jahr, monat - 1, tag + vor));
  return `${d.toISOString().slice(0, 10)}T${uhrzeit}`;
}
