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

const POS = { 1: "TW", 2: "ABW", 3: "MF", 4: "ANG" };
export function position(p) {
  return POS[p] ?? "–";
}

// Probiert mehrere mögliche Feldnamen durch
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
