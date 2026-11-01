import { naechsterAnpfiff } from "./db.js";
import { spieltagWahl } from "./loginbonus.js";
import { naechsterWochentagText } from "./rhythmus.js";
import { ausEingabe, wochentag, ZONE } from "./format.js";

// ── Wann beginnt der nächste Spieltag? ───────────────────────────
//
// Aus dem Spielplan: das erste Spiel, das noch bevorsteht. Kennt er
// keins (noch nie aktualisiert, Saisonende), gilt der eingestellte
// Spieltagsbeginn — Freitag 20:30, oder Samstag 15:30 — und die Seite
// sagt, woher die Zahl kommt.
//
// Markt- und Matchup-Seite fragen beide danach; zwei Kopien liefen
// früher oder später auseinander.
export async function ermittleAnpfiff(settings, jetzt = new Date()) {
  // Der erste Anpfiff des nächsten Spieltags, der noch nicht begonnen hat —
  // läuft einer, ist es schon der danach (siehe naechsterAnpfiff()).
  const ausPlan = await naechsterAnpfiff();
  if (ausPlan) {
    return {
      anpfiff: ausPlan.anpfiff,
      spieltag: ausPlan.spieltag,
      quelle: ausPlan.spieltag ? `Spielplan, Spieltag ${ausPlan.spieltag}` : "Spielplan",
    };
  }
  const wahl = spieltagWahl(settings?.spieltag_start);
  const berlin = jetzt.toLocaleString("sv-SE", { timeZone: ZONE }).replace(" ", "T").slice(0, 16);
  const anpfiff = ausEingabe(naechsterWochentagText(
    berlin, wochentag(jetzt), wahl.tag, wahl.schluessel === "sa" ? "15:30" : "20:30"));
  // Springt von selbst weiter: Am Samstag ist der nächste Freitag gemeint.
  return { anpfiff, spieltag: null, quelle: `Einstellung (${wahl.label})` };
}
