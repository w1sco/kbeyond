import { sql } from "./db";

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

export async function ladeTeamwerte(leagueId, managerIds, token, opt = {}) {
  const { frist = Date.now() + 45_000 } = opt;
  let geladen = 0;

  for (const uid of managerIds) {
    if (Date.now() > frist) {
      return { geladen, gesamt: managerIds.length, gestoppt: true };
    }

    try {
      const d = await kbGet(`/v4/leagues/${leagueId}/managers/${uid}/dashboard`, token);
      const tv = Number(d.tv ?? 0);
      const anzahl = Number(d.t ?? 0);

      await sql`
        INSERT INTO teamwerte (league_id, manager_id, teamwert, spieler, stand)
        VALUES (${leagueId}, ${String(uid)}, ${tv}, ${anzahl}, NOW())
        ON CONFLICT (league_id, manager_id) DO UPDATE
          SET teamwert = ${tv}, spieler = ${anzahl}, stand = NOW()`;
      geladen++;
    } catch {
      // Manager überspringen
    }
    await schlaf(180);
  }

  return { geladen, gesamt: managerIds.length, gestoppt: false };
}
