// Was zahlen Manager über dem Marktwert?
//
// Reine Rechnung, ohne Datenbank — damit sie sich einzeln durchrechnen lässt.
//
// Der Aufschlag eines Kaufs ist Kaufpreis minus Marktwert des Spielers zum
// Zeitpunkt des Angebots. Die Bezugsgröße ist der Marktwert, den Kickbase im
// Angebot nennt — nicht der von heute, sonst würde jede spätere
// Marktwertänderung den Aufschlag verfälschen.
//
// Zwei Quellen für den Marktwert des Angebots:
//   1. Das Feed-Event Typ 3 ("Spieler neu am Markt") trägt `mv` mit
//   2. Die eigene Mitschrift des Live-Markts
//
// Käufe, zu denen sich kein Angebot finden lässt, bleiben außen vor. Wie
// viele das sind, wird mitgezählt und angezeigt — ein Durchschnitt aus der
// Hälfte der Käufe soll nicht so aussehen, als wäre er aus allen.

// Woher stammt ein Kauf?
//
// Ein Kauf vom Markt (Kickbase als Verkäufer) und ein Deal zwischen zwei
// Mitspielern folgen völlig unterschiedlicher Logik: Beim Markt bietet man
// über den Marktwert, um den Zuschlag zu bekommen; bei einem Mitspieler wird
// verhandelt, und der Preis hat mit dem Marktwert oft wenig zu tun. Beides
// in einen Durchschnitt zu werfen ergibt keine Aussage.
export const HERKUNFT = [
  { schluessel: "markt", label: "vom Markt", passt: (z) => !z.seller },
  { schluessel: "manager", label: "von Mitspielern", passt: (z) => Boolean(z.seller) },
  { schluessel: "alle", label: "alle Käufe", passt: () => true },
];

export function filtereHerkunft(zeilen, schluessel) {
  const h = HERKUNFT.find((x) => x.schluessel === schluessel) ?? HERKUNFT[0];
  return zeilen.filter(h.passt);
}

// Fasst Käufe zu einer Auswertung zusammen – für die ganze Liga oder für
// einen Manager, je nachdem was übergeben wird.
export function werteAus(zeilen) {
  const mitWert = zeilen.filter((z) => z.marktwert != null && Number(z.marktwert) > 0);

  const posten = mitWert.map((z) => {
    const preis = Number(z.preis);
    const mw = Number(z.marktwert);
    return {
      ...z,
      preis,
      marktwert: mw,
      aufschlag: preis - mw,
      relativ: (preis - mw) / mw,
    };
  });

  if (posten.length === 0) {
    return { anzahl: 0, gesamt: zeilen.length, ohneWert: zeilen.length, schnitt: null, relativ: null, posten: [] };
  }

  const summe = posten.reduce((s, p) => s + p.aufschlag, 0);

  // Der relative Schnitt gewichtet jeden Kauf gleich – sonst würde ein
  // einziger teurer Spieler die Quote der ganzen Liga bestimmen.
  const relSumme = posten.reduce((s, p) => s + p.relativ, 0);

  return {
    anzahl: posten.length,
    // Wie viele Käufe es insgesamt gab – ohne das lässt sich der
    // Durchschnitt nicht einordnen.
    gesamt: zeilen.length,
    ohneWert: zeilen.length - posten.length,
    schnitt: summe / posten.length,
    relativ: relSumme / posten.length,
    gesamtsumme: summe,
    posten,
  };
}

// Je Manager, absteigend nach durchschnittlichem Aufschlag.
export function proManager(zeilen) {
  const gruppen = new Map();
  for (const z of zeilen) {
    if (!gruppen.has(z.buyer)) gruppen.set(z.buyer, []);
    gruppen.get(z.buyer).push(z);
  }

  return [...gruppen.entries()]
    .map(([name, eigene]) => ({ name, ...werteAus(eigene) }))
    .filter((m) => m.anzahl > 0)
    .sort((a, b) => b.relativ - a.relativ);
}

export const ZEITRAEUME = [
  { schluessel: "reset", label: "seit Reset", tage: null },
  { schluessel: "14", label: "14 Tage", tage: 14 },
  { schluessel: "7", label: "7 Tage", tage: 7 },
  { schluessel: "3", label: "3 Tage", tage: 3 },
  { schluessel: "1", label: "1 Tag", tage: 1 },
];

export function zeitraumAb(schluessel, stichtag) {
  const z = ZEITRAEUME.find((x) => x.schluessel === schluessel);
  if (!z || z.tage == null) return stichtag;
  return new Date(Date.now() - z.tage * 86_400_000);
}
