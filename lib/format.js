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

export function zeitpunkt(d) {
  if (!d) return "nie";
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
