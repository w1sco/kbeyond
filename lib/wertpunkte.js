// Wert und Punkte: Wie steht der Gesamtwert eines Managers zu seinen Punkten?
//
// Gesamtwert = Teamwert + Kontostand, also das ganze Vermögen. Punkte sind
// die Kickbase-Saisonpunkte. Zwei Maße daraus:
//
//   **Mio je Punkt** — Gesamtwert geteilt durch Punkte. Das direkte
//   Verhältnis, aber mit einer Schwäche: Alle starten mit demselben
//   Budget. Früh in der Saison, bei wenigen Punkten, ist die Zahl für
//   jeden riesig und sagt wenig.
//
//   **Abstand zum Trend** — die Liga legt eine Gerade durch alle
//   Manager (kleinste Quadrate): welcher Gesamtwert zu wie vielen Punkten
//   in dieser Liga passt. Der Abstand dazu ist die Aussage. Positiv:
//   mehr Vermögen, als die Punkte erwarten lassen. Negativ: holt mehr
//   Punkte aus weniger Vermögen. Die Gerade hat einen Achsenabschnitt,
//   und genau das fängt das gemeinsame Startbudget ab.
//
// Reine Rechnung, keine Datenbank.

// Die Gerade y = a + b·x durch die Punkte, kleinste Quadrate. Unter drei
// Managern oder ohne Streuung der Punkte (alle gleich, etwa vor dem ersten
// Spieltag) gibt es keine — eine Gerade durch zwei Punkte ist keine
// Aussage über die Liga.
export function trendlinie(paare = []) {
  const p = paare.filter((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y));
  if (p.length < 3) return null;
  const n = p.length;
  const mx = p.reduce((s, q) => s + q.x, 0) / n;
  const my = p.reduce((s, q) => s + q.y, 0) / n;
  const sxx = p.reduce((s, q) => s + (q.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = p.reduce((s, q) => s + (q.x - mx) * (q.y - my), 0);
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

// Je Manager die Kennzahlen.
//
// `manager`: [{ id, name, punkte, gesamt }] — gesamt null, wenn der Manager
// seine Finanzzahlen verbirgt oder kein Teamwert geladen ist. Solche
// Manager stehen in der Liste, aber ohne Kennzahlen, und sie fließen nicht
// in die Gerade ein: Sonst verschöbe ein unbekannter Wert die Aussage über
// alle anderen.
export function werteAus(manager = []) {
  const mitWert = manager.filter((m) => m.gesamt != null && Number.isFinite(Number(m.punkte)));
  const trend = trendlinie(mitWert.map((m) => ({ x: Number(m.punkte), y: Number(m.gesamt) })));
  const zeilen = manager.map((m) => {
    const punkte = Number(m.punkte ?? 0);
    const gesamt = m.gesamt == null ? null : Number(m.gesamt);
    const erwartet = trend && gesamt != null ? trend.a + trend.b * punkte : null;
    return {
      ...m,
      punkte,
      gesamt,
      // Ohne Punkte kein Verhältnis: 200 Mio durch 0 wäre keine Zahl,
      // und „unendlich teuer“ ist keine Aussage über einen Manager.
      mioJePunkt: gesamt != null && punkte > 0 ? gesamt / punkte : null,
      erwartet,
      abstand: erwartet != null ? gesamt - erwartet : null,
    };
  });
  return { zeilen, trend, gezaehlt: mitWert.length };
}

// Der Weg jedes Managers durch die Saison: je Tag Punkte und Gesamtwert,
// nur wo beides bekannt ist. Eine Lücke bleibt eine Lücke — ein Tag ohne
// Punkte wird nicht mit dem Vortag gefüllt.
//
// `zeilen`: aus getTagesverlauf() — { managerId, tag, teamwert, konto, punkte }
export function pfade(zeilen = []) {
  const je = new Map();
  for (const z of zeilen) {
    if (z.teamwert == null || z.konto == null || z.punkte == null) continue;
    const id = String(z.managerId);
    if (!je.has(id)) je.set(id, []);
    je.get(id).push({
      tag: String(z.tag instanceof Date ? z.tag.toISOString() : z.tag).slice(0, 10),
      punkte: Number(z.punkte),
      gesamt: Number(z.teamwert) + Number(z.konto),
    });
  }
  for (const liste of je.values()) liste.sort((a, b) => a.tag.localeCompare(b.tag));
  return je;
}
