export function euro(n) {
  if (n == null || isNaN(n)) return "–";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
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
