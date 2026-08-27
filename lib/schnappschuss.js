import { sql, getKader, getBesitz, getTeamwerte, getSettings } from "./db";
import { berechneKonten } from "./ledger";
import { holePool } from "./rekonstruktion";
import { euro } from "./format";

// Baut den Datensatz, über den die Frage-Funktion Auskunft gibt.
//
// Bewusst als Text und nicht als JSON: kompakter, und das Modell muss keine
// Struktur entpacken. Der Aufbau ist stabil, damit er sich zwischenspeichern
// lässt — nur die Frage am Ende wechselt.
export async function baueSchnappschuss(leagueId, token, nutzer, ranking) {
  const settings = await getSettings(leagueId, nutzer);
  const manager = (ranking.us ?? []).filter((m) => m.adm !== true);

  const konten = await berechneKonten(leagueId, manager, settings);
  const tw = await getTeamwerte(leagueId);
  const kader = await getKader(leagueId);
  const besitz = await getBesitz(leagueId);

  const feedStart = (await sql`
    SELECT MIN(dt) AS dt FROM events
    WHERE league_id = ${leagueId} AND id NOT LIKE 'rk%'`)[0]?.dt ?? null;
  const luecke = feedStart && new Date(feedStart) > new Date(settings.stichtag);

  const zeilen = [];
  zeilen.push(`LIGA: ${ranking.ti ?? leagueId} (ID ${leagueId})`);
  zeilen.push(`Startbudget: ${euro(Number(settings.startbudget))} · Bonus pro Punkt: ${euro(Number(settings.punkte_bonus))}`);
  if (luecke) {
    zeilen.push(
      "ACHTUNG: Diese Liga hat eine Datenlücke. Für alle Manager außer dem " +
      "angemeldeten Nutzer sind die Kontostände Näherungen — Strafen aus dem " +
      "fehlenden Zeitraum fehlen. Sag das dazu, wenn es für die Antwort zählt."
    );
  }

  zeilen.push("");
  zeilen.push("MANAGER (Kontostand = Guthaben; Limit = Teamwert/3 = erlaubtes Minus;");
  zeilen.push("Max-Gebot = Kontostand + Limit; Gesamtwert = Kontostand + Teamwert):");

  for (const k of konten) {
    const t = tw.map.get(String(k.id));
    const teamwert = t?.teamwert ?? 0;
    const limit = Math.floor(teamwert / 3);
    const eigene = kader.proManager.get(String(k.id)) ?? [];
    zeilen.push(
      `- ${k.name} (ID ${k.id}): Kontostand ${euro(k.konto)}, Teamwert ${euro(teamwert)}, ` +
      `Limit ${euro(limit)}, Max-Gebot ${euro(k.konto + limit)}, ` +
      `Gesamtwert ${euro(k.konto + teamwert)}, ${eigene.length} Spieler, ${k.punkte} Punkte` +
      (k.strafen !== 0 ? `, Strafen ${euro(k.strafen)}` : "") +
      (k.korrektur !== 0 ? `, Korrektur ${euro(k.korrektur)}` : "")
    );
  }

  zeilen.push("");
  zeilen.push("KADER (Spieler | Position | Marktwert | Kaufpreis):");
  for (const k of konten) {
    const eigene = kader.proManager.get(String(k.id)) ?? [];
    if (eigene.length === 0) continue;
    zeilen.push(`${k.name}:`);
    for (const s of eigene) {
      zeilen.push(
        `  ${s.name} | ${s.position ?? "?"} | ${euro(s.marktwert)}` +
        (s.kaufpreis != null ? ` | gekauft für ${euro(s.kaufpreis)}` : "")
      );
    }
  }

  // Freie Spieler: die teuersten zuerst, der lange Schwanz billiger
  // Ergänzungsspieler bringt für Fragen nichts und kostet nur Kontext.
  const pool = await holePool();
  const vergeben = new Set([...kader.besetzt, ...besitz.besitzer.keys()]);
  const frei = pool.spieler
    .filter((s) => !vergeben.has(String(s.id)))
    .sort((a, b) => Number(b.marktwert ?? 0) - Number(a.marktwert ?? 0));

  zeilen.push("");
  zeilen.push(`FREIE SPIELER (gehören keinem Manager, ${frei.length} insgesamt, hier die 80 wertvollsten):`);
  for (const s of frei.slice(0, 80)) {
    zeilen.push(`  ${s.name} | ${s.position ?? "?"} | ${euro(s.marktwert)}`);
  }

  return { text: zeilen.join("\n"), anzahlManager: konten.length, luecke };
}
