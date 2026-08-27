// Wann kommt ein Spieler wieder auf den Transfermarkt?
//
// Spieler kehren nach einem festen Rhythmus zurück, anfangs etwa alle 14
// Tage. Der Rhythmus ändert sich mit der Zeit: je leerer der Markt, desto
// schneller kommen sie wieder.
//
// ── Was beobachtet wird ──────────────────────────────────────────────
//
// Entscheidend ist, das *Erscheinen* zu beobachten und nicht den Kauf. Ein
// Spieler kann auf den Markt kommen, ungekauft ablaufen und 14 Tage später
// wiederkommen und dann gekauft werden — zwischen den beiden Käufen lägen
// 28 Tage, der Rhythmus ist aber 14. Der Feed liefert dafür Typ 3
// ("Spieler neu am Markt"), also das Erscheinen selbst.
//
// Drei Quellen, alle in derselben Zeitreihe:
//   1. Feed-Events Typ 3      — das Erscheinen, die beste Quelle
//   2. Käufe von Kickbase      — wer gekauft wurde, war vorher am Markt
//   3. Der Live-Markt          — wer gerade dort steht
//
// ── Was ignoriert wird ──────────────────────────────────────────────
//
// Alles vor dem Stichtag. Die Historie vor dem Liga-Reset sagt über den
// aktuellen Rhythmus nichts aus.

// Beobachtungen, die dichter beieinanderliegen, gehören zum selben
// Auftritt: ein Angebot steht rund einen Tag, und Erscheinen und Kauf
// desselben Angebots dürfen nicht als zwei Auftritte zählen.
export const AUFTRITT_FENSTER_H = 36;

// Unter so vielen Abständen wird nicht geschätzt, sondern zugegeben, dass
// es noch zu früh ist.
export const MINDEST_ABSTAENDE = 4;

// Ein Angebot steht rund einen Tag. Zwei Auftritte desselben Spielers, die
// enger als das beieinanderliegen, sind kein Rhythmus — sie kommen von einem
// Angebot, das doppelt beobachtet wurde, oder von einem Mitspieler, der neu
// inseriert hat. Solche Abstände verzerren den Median nach unten und lassen
// dann jeden Spieler "überfällig" aussehen.
export const MINDEST_ABSTAND_TAGE = 2;

// Der Rhythmus, mit dem eine Liga startet. Wird benutzt, solange zu wenig
// beobachtet wurde, um selbst zu messen — das ist keine Erfindung, sondern
// die bekannte Ausgangslage: zu Beginn kommen Spieler etwa alle 14 Tage
// wieder. Eine Prognose daraus ist besser als "Rhythmus unbekannt", und sie
// wird als Annahme gekennzeichnet.
export const BASIS_ZYKLUS_TAGE = 14;

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

// Abstände zwischen aufeinanderfolgenden Auftritten, in Tagen.
export function abstaendeAus(auftritte) {
  const raus = [];
  for (let i = 1; i < auftritte.length; i++) {
    raus.push({
      tage: (auftritte[i] - auftritte[i - 1]) / TAG_MS,
      bis: auftritte[i],
    });
  }
  return raus;
}

function median(zahlen) {
  if (zahlen.length === 0) return null;
  const s = [...zahlen].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Der aktuelle Rhythmus der Liga.
//
// Median statt Mittelwert, weil einzelne Ausreißer sonst durchschlagen.
// Zwei Korrekturen:
//
// - Nur die jüngsten Abstände zählen. Der Rhythmus verkürzt sich mit der
//   Zeit; ein Abstand von vor sechs Wochen beschreibt nicht mehr das Heute.
// - Abstände, die grob ein Vielfaches des Medians sind, fliegen raus. Sie
//   entstehen, wenn ein Auftritt nicht beobachtet wurde — etwa weil das
//   Feed-Fenster ihn nicht mehr hergibt. Ein doppelter Abstand ist dann
//   kein doppelter Rhythmus, sondern eine Lücke in den Daten.
export function schaetzeZyklus(abstaende, opt = {}) {
  const { jungeTage = 21, jetzt = new Date() } = opt;

  const plausibel = abstaende.filter((a) => a.tage >= MINDEST_ABSTAND_TAGE);
  const zuEng = abstaende.length - plausibel.length;

  if (plausibel.length < MINDEST_ABSTAENDE) {
    return {
      tage: null,
      grund: "zu wenige Abstände",
      anzahl: plausibel.length,
      verworfen: 0,
      zuEng,
    };
  }

  const grenze = new Date(jetzt.getTime() - jungeTage * TAG_MS);
  const jung = plausibel.filter((a) => a.bis >= grenze);
  const basis = jung.length >= MINDEST_ABSTAENDE ? jung : plausibel;

  const vorlaeufig = median(basis.map((a) => a.tage));

  // Alles über dem 1,6-fachen ist eher eine Beobachtungslücke als ein Rhythmus
  const ohneVielfache = basis.filter((a) => a.tage <= vorlaeufig * 1.6);
  const endgueltig = median(
    (ohneVielfache.length >= MINDEST_ABSTAENDE ? ohneVielfache : basis).map((a) => a.tage)
  );

  return {
    tage: endgueltig,
    grund: null,
    anzahl: basis.length,
    verworfen: basis.length - ohneVielfache.length,
    zuEng,
    nurJunge: jung.length >= MINDEST_ABSTAENDE,
  };
}

// Prognose für einen einzelnen Spieler.
//
// Verankert wird am letzten Ereignis, das den Spieler wieder frei gemacht
// hat. Das ist entweder sein letzter Auftritt am Markt (er lief ungekauft
// ab) oder sein Verkauf an Kickbase — je nachdem, was später war.
//
// Der Verkauf zählt mit, weil er die Uhr neu setzt: Ein Spieler, der gekauft
// und wieder verkauft wurde, geht zurück in den Pool und kommt von dort nach
// dem Rhythmus wieder. Ohne diesen Anker stand bei genau diesen Spielern
// "Rhythmus unbekannt", obwohl sich die Prognose direkt ausrechnen lässt.
export function prognostiziere({
  auftritte,
  verkauftAm = null,
  zyklusTage,
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

  // Gemessener Rhythmus, wenn es genug Beobachtungen gibt; sonst der
  // bekannte Startwert der Liga.
  const zyklus = zyklusTage ?? BASIS_ZYKLUS_TAGE;
  const gemessen = zyklusTage != null;

  const naechster = new Date(anker.getTime() + zyklus * TAG_MS);
  const tageHin = (naechster - jetzt) / TAG_MS;

  const durchVerkauf = verkauftAm != null && anker.getTime() === verkauftAm.getTime();

  // Ein einzelner Auftritt trägt weniger als eine eigene Reihe
  const sicherheit = !gemessen
    ? "annahme"
    : auftritte.length >= 3
      ? "gut"
      : auftritte.length === 2
        ? "mittel"
        : "grob";

  if (tageHin < -1) {
    return { lage: "ueberfaellig", anker, naechster, tageHin, sicherheit, gemessen, durchVerkauf };
  }
  return { lage: "erwartet", anker, naechster, tageHin, sicherheit, gemessen, durchVerkauf };
}
