// Wessen Zahlen darf wer sehen?
//
// Der Zweck dieses Projekts ist, die Kontostände **aller** Manager
// sichtbar zu machen — auch der, die Kickbase selbst nie zeigt. Sobald
// aber jemand zweites die App benutzt, gilt das auch für die eigenen
// Zahlen. Wer die App betreibt, will seinen Mitspielern nicht
// zwangsläufig sein Budget offenlegen.
//
// Deshalb kann eine Person ihre **Finanzzahlen** für alle anderen
// verbergen. Verborgen wird genau das, was diese App errechnet und
// Kickbase selbst nicht preisgibt:
//
//   Kontostand, Limit, Max-Gebot, Gesamtwert, Liquidität,
//   Käufe- und Verkaufssummen, Strafen, Korrektur, Login- und
//   Punkte-Bonus.
//
// **Nicht** verborgen wird, was in Kickbase ohnehin jeder sieht:
// Teamwert, Punkte, Platz, Kader, Marktwerte, MW-Trend. Das wäre
// Theater — die Zahlen stehen eine App weiter offen.
//
// > **Was das nicht ist: eine Geheimhaltung.** Der Kontostand lässt sich
// > aus dem Liga-Feed rekonstruieren, und den kann jedes Liga-Mitglied
// > über Kickbases eigene Schnittstelle abrufen. Wer diese Rechnung
// > nachbaut, kommt zum selben Ergebnis. Verborgen heißt hier: nicht auf
// > dem Silbertablett — nicht: unerreichbar.
//
// Reine Rechnung, keine Datenbank.

// Die Felder aus `berechneKonten()`, die verschwinden müssen. Abgeleitete
// (Limit, Max-Gebot, Gesamtwert, Quote) hängen alle am Kontostand und
// fallen mit ihm.
export const GELDFELDER = [
  "konto", "kaeufe", "verkaeufe", "strafen", "korrektur",
  "loginBonus", "punkteBonus", "bonusEcht", "bonusFormel",
  "limit", "maxGebot", "gesamtwert",
];

// Welche Tabellenspalten daran hängen — die Tabelle fragt hier nach,
// statt die Liste ein zweites Mal zu führen.
export const GELDSPALTEN = new Set([
  "konto", "gesamtwert", "maxGebot", "limit", "quote",
  "anpassungen", "strafen", "korrektur",
]);

// ── Wer wird verborgen? ─────────────────────────────────────────────
//
// Die Freigabeliste kennt Menschen (E-Mail), die Ligatabelle kennt
// Manager. Verbunden wird über die Kickbase-ID, ersatzweise über den
// Anzeigenamen — dieselbe Reihenfolge, mit der sich der Nutzer auf der
// Ligaseite selbst zuordnet.
//
// **Bei einem doppelten Namen werden alle Treffer verborgen.** Zwei
// Manager gleichen Namens lassen sich über den Namen nicht
// auseinanderhalten; einmal zu viel verbergen ist hier der harmlose
// Fehler, einmal zu wenig der schädliche.
//
// Sich selbst sieht man immer.
export function wenVerbergen({ zugaenge = [], spieler = [], betrachterId = null } = {}) {
  const geheim = new Set();

  for (const z of zugaenge) {
    if (!z?.zahlen_privat) continue;

    const uid = z.kb_uid == null ? null : String(z.kb_uid);
    const ueberUid = uid ? spieler.filter((m) => String(m?.i) === uid) : [];

    const treffer = ueberUid.length
      ? ueberUid
      : (z.name ? spieler.filter((m) => m?.n === z.name) : []);

    for (const m of treffer) geheim.add(String(m.i));
  }

  if (betrachterId != null) geheim.delete(String(betrachterId));
  return geheim;
}

// ── Verbergen ───────────────────────────────────────────────────────
//
// Auf **null** gesetzt, nicht auf 0: Eine 0 ist eine Aussage („er hat
// kein Geld"), null ist keine. Dieselbe Regel wie beim Kaderwert im
// Verlauf — „ein leerer Kader ist 0, ein unbekannter ist nichts".
//
// Und es passiert auf dem **Server**. Ein Ausgrauen im Browser wäre
// keins: Die Zahl stünde trotzdem im ausgelieferten Seitenzustand und
// wäre mit zwei Klicks zu lesen.
export function verbergeKonten(konten = [], geheim = new Set()) {
  if (geheim.size === 0) return konten;
  return konten.map((k) => {
    if (!geheim.has(String(k?.id))) return k;
    const raus = { ...k, finanzenGeheim: true };
    for (const feld of GELDFELDER) raus[feld] = null;
    return raus;
  });
}

// Der Tagesverlauf trägt dieselben Zahlen über die Zeit. Ohne diesen
// Schnitt stünde der Kontostand im Diagramm, nur eben als Linie.
export function verbergeTagesstand(zeilen = [], geheim = new Set()) {
  if (geheim.size === 0) return zeilen;
  return zeilen.map((z) =>
    geheim.has(String(z?.managerId)) ? { ...z, konto: null } : z);
}
