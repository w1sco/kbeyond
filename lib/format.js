export function euro(n) {
  if (n == null || isNaN(n)) return "–";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

// Kurzform für schmale Displays: "12,3 Mio" statt "12.345.678 €".
// Auf dem Handy stehen drei Geldspalten nebeneinander – ausgeschrieben
// passen die nicht.
export function euroKurz(n) {
  if (n == null || isNaN(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const mio = (n / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 1 });
    return `${mio} Mio`;
  }
  if (abs >= 10_000) {
    return `${Math.round(n / 1000).toLocaleString("de-DE")} Tsd`;
  }
  return n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

// Anteil des Vermögens, der flüssig ist: Kontostand / Gesamtwert.
export function prozent(anteil) {
  if (anteil == null || isNaN(anteil)) return "–";
  return `${(anteil * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
}

export function restzeit(sekunden) {
  if (sekunden == null || isNaN(sekunden)) return "–";
  const h = Math.floor(sekunden / 3600);
  const m = Math.floor((sekunden % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

// ── Zeitzone ────────────────────────────────────────────────────────────
//
// Alles wird in deutscher Zeit angezeigt und eingegeben, unabhängig davon,
// wo der Server steht. Ohne diese Festlegung nimmt toLocaleString die Zone
// der Laufzeitumgebung — auf Vercel ist das UTC, also im Sommer zwei
// Stunden neben der Uhr des Nutzers.
//
// Fest auf Berlin und nicht auf die Zone des Browsers, weil die Liga eine
// deutsche ist: Marktschluss und Liga-Reset nennt Kickbase in deutscher
// Zeit. Ein fester Wert hat außerdem den Vorteil, dass Server und Browser
// dieselbe Zeichenkette erzeugen — sonst gäbe es beim Hydrieren Ärger.
export const ZONE = "Europe/Berlin";

// Wie weit liegt die Zone zu diesem Zeitpunkt vor UTC (in Millisekunden)?
// Wechselt zwischen +1 h (Winter) und +2 h (Sommer).
function versatz(zeitpunktMs) {
  const teile = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
    .formatToParts(new Date(zeitpunktMs))
    .reduce((a, t) => ((a[t.type] = t.value), a), {});

  const alsWaereEsUtc = Date.UTC(
    Number(teile.year), Number(teile.month) - 1, Number(teile.day),
    Number(teile.hour) % 24, Number(teile.minute), Number(teile.second)
  );
  return alsWaereEsUtc - zeitpunktMs;
}

export function zeitpunkt(d) {
  if (!d) return "nie";
  return new Date(d).toLocaleString("de-DE", {
    timeZone: ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Für <input type="datetime-local"> — erwartet "JJJJ-MM-TTThh:mm" in der
// Zeit, die der Nutzer sieht, nicht in UTC.
export function fuerEingabe(d) {
  if (!d) return "";
  return berlinTeile(new Date(d)).slice(0, 16);
}

// Für <input type="date">
export function fuerTag(d) {
  if (!d) return "";
  return berlinTeile(new Date(d)).slice(0, 10);
}

// "sv-SE" formatiert als "2026-08-08 00:48:00" — schon fast ISO.
function berlinTeile(datum) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: ZONE,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
    .format(datum)
    .replace(" ", "T");
}

// ── Der Marktwert-Tag ───────────────────────────────────────────────
//
// Kickbase passt die Marktwerte einmal täglich um 22:04 deutscher Zeit an.
// Für die Frage "wie viel haben die Spieler seit gestern gewonnen oder
// verloren" ist deshalb nicht der Kalendertag maßgeblich, sondern der
// Zeitraum von einer Anpassung zur nächsten.
//
// Ein um 10:00 abgelesener Marktwert stammt aus der Anpassung des Vorabends
// und gehört damit zum Marktwert-Tag davor. Ohne diese Verschiebung lägen
// die Ablesungen eines Tages auf zwei Seiten der Grenze und die Differenz
// wäre mal 0 und mal die doppelte Bewegung.
export const MW_UHRZEIT = "22:04";

export function mwTag(d) {
  if (!d) return null;
  const teile = berlinTeile(new Date(d));
  if (teile.length < 16) return null;

  const datum = teile.slice(0, 10);
  if (teile.slice(11, 16) >= MW_UHRZEIT) return datum;

  // Kalenderrechnung auf einem reinen Datum – in UTC exakt und von der
  // Sommerzeit unberührt, anders als ein Abzug von 24 Stunden.
  const vortag = new Date(`${datum}T00:00:00Z`);
  if (isNaN(vortag)) return null;
  vortag.setUTCDate(vortag.getUTCDate() - 1);
  return vortag.toISOString().slice(0, 10);
}

// Der Zeitpunkt der letzten Marktwertanpassung. Danach sind gespeicherte
// Kader und Teamwerte veraltet, auch wenn niemand einen Transfer gemacht hat.
export function letztesMwUpdate(jetzt = new Date()) {
  const tag = mwTag(jetzt);
  return tag ? ausEingabe(`${tag}T${MW_UHRZEIT}`) : null;
}

// Wie viele Mitternachte (deutscher Zeit) liegen zwischen Start und jetzt?
//
// Der Login-Bonus wird um 0:00 Uhr für den neuen Tag gutgeschrieben. Es
// zählen also Kalendertage, nicht verstrichene 24-Stunden-Blöcke: startet
// eine Liga um 00:48, sprang der Zähler vorher jeden Tag um 00:48 statt um
// Mitternacht — zwischen 0:00 und 0:48 lag die Rechnung damit einen ganzen
// Tag und im konstanten Bereich 100.000 € daneben.
export function tageSeit(start, jetzt = new Date()) {
  if (!start) return 0;
  const a = Date.parse(`${fuerTag(start)}T00:00:00Z`);
  const b = Date.parse(`${fuerTag(jetzt)}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return 0;
  // Beide sind exakte Mitternachte, die Differenz also ein glattes Vielfaches.
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// Umgekehrter Weg: Die Eingabe ist deutsche Ortszeit und muss als solche
// verstanden werden. Ohne das landet "00:48" als 00:48 UTC in der
// Datenbank — also zwei Stunden zu spät, was beim Stichtag Transfers
// ein- oder ausschließen kann.
export function ausEingabe(text) {
  if (!text) return null;

  // Erst so tun, als wäre die Eingabe UTC, dann um den Versatz korrigieren.
  const alsUtc = Date.parse(`${text.length === 16 ? text : text.slice(0, 16)}:00Z`);
  if (isNaN(alsUtc)) return null;

  // Zwei Runden, weil der Versatz selbst vom Zeitpunkt abhängt: an den
  // beiden Umstellungstagen liegt die erste Schätzung sonst daneben.
  //
  // Bleibt ein Fall, den keine Umrechnung lösen kann: in der Nacht der
  // Rückstellung gibt es 02:30 zweimal. Diese Eingabe wird als die zweite
  // (Winterzeit) gelesen. Für einen Stichtag ist das ohne Belang.
  let ergebnis = alsUtc - versatz(alsUtc);
  ergebnis = alsUtc - versatz(ergebnis);
  return new Date(ergebnis);
}

export function vorZeit(d) {
  if (!d) return "";
  const sek = Math.floor((Date.now() - new Date(d)) / 1000);
  if (sek < 60) return "gerade eben";
  const min = Math.floor(sek / 60);
  if (min < 60) return `vor ${min} Min.`;
  const std = Math.floor(min / 60);
  if (std < 24) return `vor ${std} Std.`;
  const tage = Math.floor(std / 24);
  return `vor ${tage} ${tage === 1 ? "Tag" : "Tagen"}`;
}

// Gegenstück zu vorZeit: für Zeitpunkte, die noch kommen. vorZeit rechnet
// jetzt − d und liefert bei einem Zeitpunkt in der Zukunft "gerade eben".
export function inZeit(d) {
  if (!d) return "";
  const sek = Math.floor((new Date(d) - Date.now()) / 1000);
  if (sek <= 0) return "abgelaufen";
  const min = Math.floor(sek / 60);
  if (min < 60) return `in ${Math.max(1, min)} Min.`;
  const std = Math.floor(min / 60);
  if (std < 24) return `in ${std} Std.`;
  const tage = Math.floor(std / 24);
  return `in ${tage} ${tage === 1 ? "Tag" : "Tagen"}`;
}

const POS = { 1: "TW", 2: "ABW", 3: "MF", 4: "ANG" };
export function position(p) {
  return POS[p] ?? "–";
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
  }
  return undefined;
}

export function normalisiereSpieler(raw) {
  const vorname = pick(raw, ["fn", "firstName"]) ?? "";
  const nachname = pick(raw, ["ln", "n", "lastName", "name"]) ?? "";
  return {
    id: pick(raw, ["i", "id", "pi"]),
    name: `${vorname} ${nachname}`.trim() || "Unbekannt",
    position: position(pick(raw, ["pos", "position"])),
    marktwert: pick(raw, ["mv", "marketValue"]),
    preis: pick(raw, ["prc", "price"]),
    trend: pick(raw, ["mvt", "marketValueTrend"]),
    punkte: pick(raw, ["tp", "totalPoints", "p"]),
    schnitt: pick(raw, ["ap", "averagePoints"]),
    ablauf: pick(raw, ["exs", "expiry", "dt"]),
    anbieter: pick(raw?.u ?? raw?.usr ?? {}, ["n", "name", "unm"]),
    _raw: raw,
  };
}

// Welches Feld die Kaderliste in /squad trägt, ist nicht dokumentiert und im
// Projekt nie belegt worden. Statt einen Feldnamen zu raten, wird die ganze
// Antwort durchsucht: gesucht ist das Array mit den meisten Einträgen, die
// nach Spielern aussehen.
//
// Ein erster Versuch prüfte nur die oberste Ebene und verlangte feste Felder —
// der fand in echten Antworten nichts, und dann galten auf der Marktseite alle
// Spieler als frei.

const NAMENSFELDER = ["n", "ln", "fn", "name", "lastName", "firstName", "pn"];
const ZAHLENFELDER = ["mv", "marketValue", "prc", "price", "tp", "totalPoints", "p",
                      "ap", "averagePoints", "mvgl", "pos", "position", "st"];

function siehtNachSpielerAus(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const hatName = NAMENSFELDER.some((k) => typeof x[k] === "string" && x[k].length > 0);
  const hatId = ["i", "id", "pi"].some((k) => x[k] !== undefined && x[k] !== null);
  const hatZahl = ZAHLENFELDER.some((k) => x[k] !== undefined && x[k] !== null);
  return (hatName || hatId) && hatZahl;
}

export function findeSpielerListe(daten) {
  if (!daten || typeof daten !== "object") return [];

  let bestes = [];
  let besteTreffer = 0;

  const besuchen = (wert, tiefe) => {
    if (tiefe > 6 || !wert || typeof wert !== "object") return;

    if (Array.isArray(wert)) {
      const treffer = wert.filter(siehtNachSpielerAus).length;
      // Mindestens die Hälfte der Einträge muss passen, sonst ist es ein
      // Array von etwas anderem, das zufällig ein paar Zahlen enthält.
      if (treffer > besteTreffer && treffer >= Math.ceil(wert.length / 2)) {
        besteTreffer = treffer;
        bestes = wert.filter(siehtNachSpielerAus);
      }
      for (const x of wert) besuchen(x, tiefe + 1);
      return;
    }

    for (const x of Object.values(wert)) besuchen(x, tiefe + 1);
  };

  besuchen(daten, 0);
  return bestes;
}

// Bild-URL in einem API-Objekt finden.
//
// Unter welchem Feld Kickbase Spieler- und Managerbilder ausliefert, ist im
// Projekt nicht belegt. Statt einen Namen zu raten: bekannte Kandidaten
// zuerst, danach das erste Feld, dessen Wert wie eine Bildadresse aussieht.
const BILDFELDER = ["pim", "uim", "im", "img", "image", "imageUrl", "profileUrl", "pli"];

export function findeBild(roh) {
  if (!roh || typeof roh !== "object") return null;

  const brauchbar = (wert) =>
    typeof wert === "string" &&
    wert.length > 8 &&
    (/^https?:\/\//i.test(wert) || wert.startsWith("//")) &&
    /\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(wert);

  for (const feld of BILDFELDER) {
    if (brauchbar(roh[feld])) return roh[feld];
  }
  for (const wert of Object.values(roh)) {
    if (brauchbar(wert)) return wert;
  }
  return null;
}
