import { sql } from "./db";
import { findeSpielerListe, normalisiereSpieler } from "./format";

const BASE = "https://api.kickbase.com";
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function kbGet(pfad, token, versuch = 0) {
  const res = await fetch(`${BASE}${pfad}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 429 || res.status === 503) {
    if (versuch >= 3) throw new Error("Rate-Limit");
    await schlaf(1200 * Math.pow(2, versuch));
    return kbGet(pfad, token, versuch + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Lädt für jeden Manager den Kader und legt ihn ab. Damit weiß die Liga,
// welche Spieler vergeben sind — und die Managerseite kommt ohne einen
// Live-Abruf je Seitenaufruf aus.
export async function ladeKader(leagueId, managerIds, token) {
  const beginn = Date.now();
  let geladen = 0;
  let spieler = 0;
  let leer = 0;

  for (const uid of managerIds) {
    // Vercel bricht bei 60 s hart ab – vorher kontrolliert aussteigen.
    if (Date.now() - beginn > 45_000) {
      return { geladen, spieler, leer, gesamt: managerIds.length, gestoppt: true };
    }

    try {
      const antwort = await kbGet(`/v4/leagues/${leagueId}/managers/${uid}/squad`, token);
      const liste = findeSpielerListe(antwort).map(normalisiereSpieler);

      if (liste.length === 0) {
        leer++;
      } else {
        // Erst löschen, dann schreiben: verkaufte Spieler sollen verschwinden.
        await sql`DELETE FROM kader WHERE league_id = ${leagueId} AND manager_id = ${String(uid)}`;
        await sql`
          INSERT INTO kader (league_id, manager_id, player_id, name, position, marktwert, kaufpreis, punkte, stand)
          SELECT ${leagueId}::text, ${String(uid)}::text, *, NOW() FROM UNNEST(
            ${liste.map((s) => String(s.id))}::text[],
            ${liste.map((s) => s.name)}::text[],
            ${liste.map((s) => s.position)}::text[],
            ${liste.map((s) => Number(s.marktwert ?? 0))}::bigint[],
            ${liste.map((s) => (s.preis == null ? null : Number(s.preis)))}::bigint[],
            ${liste.map((s) => (s.punkte == null ? null : Number(s.punkte)))}::int[]
          )
          ON CONFLICT (league_id, manager_id, player_id) DO NOTHING`;

        spieler += liste.length;
        geladen++;

        // Die echte Kadergröße ist mehr wert als dashboard.t
        await sql`
          UPDATE teamwerte SET spieler = ${liste.length}
          WHERE league_id = ${leagueId} AND manager_id = ${String(uid)}`;
      }
    } catch {
      // Manager überspringen, der Rest soll trotzdem durchlaufen
    }
    await schlaf(200);
  }

  return { geladen, spieler, leer, gesamt: managerIds.length, gestoppt: false };
}
