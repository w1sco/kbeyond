// Wann ist der Punkte-Bonus eines Spieltags auf dem Konto?
//
// **Erst nach dem Spieltag**, Montagabend. Die Saisonpunkte in der
// Rangliste (`sp`) zählen dagegen live mit, sobald angepfiffen ist. Wer
// `sp × Bonus` rechnet, schreibt Geld gut, das noch nicht da ist — am
// Wochenende stand jeder Kontostand um die laufenden Spieltagspunkte zu
// hoch, und das Max-Gebot versprach Geld, das man nicht ausgeben kann.
//
// Ausgezahlt wird **am Tag nach dem letzten Spiel des Spieltags, um
// AUSZAHLUNG_UHRZEIT** — beim Wochenendspieltag also Montagabend. Die
// Uhrzeit ist unbelegt (der Nutzer sagt „Montag abends“), ebenso, wie es
// bei einem Spieltag unter der Woche läuft. Lieber eine Stunde zu lange
// zurückhalten als Geld zeigen, das noch nicht da ist: deshalb 20 Uhr,
// nicht früher.
//
// Reine Rechnung, keine Datenbank.

import { fuerTag, ausEingabe } from "./format.js";

export const AUSZAHLUNG_UHRZEIT = "20:00";

const naechsterTag = (tag) =>
  new Date(Date.parse(`${tag}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// Der Spieltag, dessen Bonus gerade aussteht: angepfiffen, aber noch nicht
// ausgezahlt. Sonst null.
//
// `spiele`: [{ spieltag, datum }] — datum = Anstoß
export function offenerSpieltag(spiele = [], jetzt = new Date()) {
  const jeTag = new Map();
  for (const s of spiele) {
    if (s.spieltag == null || !s.datum) continue;
    const d = new Date(s.datum);
    if (isNaN(d)) continue;
    const t = jeTag.get(Number(s.spieltag)) ?? { start: d, ende: d };
    if (d < t.start) t.start = d;
    if (d > t.ende) t.ende = d;
    jeTag.set(Number(s.spieltag), t);
  }
  const jetztMs = new Date(jetzt).getTime();
  let offen = null;
  for (const [spieltag, t] of jeTag) {
    if (t.start.getTime() > jetztMs) continue;
    const auszahlung = ausEingabe(`${naechsterTag(fuerTag(t.ende))}T${AUSZAHLUNG_UHRZEIT}`);
    if (jetztMs >= auszahlung.getTime()) continue;
    if (!offen || t.start > offen.start) offen = { spieltag, start: t.start, auszahlung };
  }
  return offen;
}

// Wie viele Punkte eines Managers noch nicht ausgezahlt sind.
//
// `mdp` aus der Rangliste sind die Punkte des laufenden Spieltags — belegt
// an einem echten Eintrag (`sp: 448, mdp: 448` am ersten Spieltag). Fehlt
// das Feld, hilft die eigene Messung vom Tag vor dem Anpfiff
// (`punkteVorher`). Fehlt auch die, ist es unbekannt: null.
export function offenePunkte({ offen, mdp, sp, punkteVorher = null }) {
  if (!offen) return 0;
  if (typeof mdp === "number" && Number.isFinite(mdp)) return mdp;
  if (punkteVorher != null && sp != null) return Number(sp) - Number(punkteVorher);
  return null;
}
