// Wer zählt als Mitspieler?
//
// Der Liga-Admin ist nicht automatisch ein Manager. In manchen Ligen
// verwaltet er nur und hat keine Mannschaft — dann würde er die Tabelle
// mit Nullwerten verwässern und im Aktualisieren-Lauf einen Kader
// verlangen, den es nicht gibt. In anderen Ligen spielt er ganz normal
// mit, und dann **muss** er überall auftauchen.
//
// Unterschieden wird deshalb nicht an der Rolle, sondern daran, ob er
// tatsächlich spielt: Wer eine Mannschaft hat oder Punkte gesammelt hat,
// ist ein Manager — Admin hin oder her.
export function spieltMit(m) {
  if (!m) return false;
  if (m.adm !== true) return true;
  return Number(m.tv ?? 0) > 0 || Number(m.sp ?? 0) > 0;
}

// Die Mitspieler einer Liga aus der Rangliste.
//
// `aktiv` sind Manager, von denen wir aus **eigenen Daten** wissen, dass
// sie spielen:
//
//   ids   – Manager mit gespeichertem Kader
//   namen – Manager, die im Feed als Käufer oder Verkäufer auftauchen
//
// Der Feed ist dabei das verlässlichste Kennzeichen: Wer Transfers macht,
// spielt mit. Teamwert und Punkte reichen nicht — sie stehen direkt nach
// einem Liga-Reset bei allen auf null, und bei einem Admin liefert die
// Rangliste sie offenbar nicht immer.
//
// Der Feed führt Manager über ihren Anzeigenamen, nicht über die ID —
// deshalb zwei Mengen statt einer.
export function nurMitspieler(liste, aktiv = null) {
  const ids = aktiv?.ids ?? (aktiv instanceof Set ? aktiv : null);
  const namen = aktiv?.namen ?? null;

  return (liste ?? []).filter(
    (m) =>
      spieltMit(m) ||
      (ids?.has?.(String(m?.i)) ?? false) ||
      (namen?.has?.(m?.n) ?? false)
  );
}
