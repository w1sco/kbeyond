// Live-Punkte holen — der Teil, der Datenbank und Kickbase anfasst.
//
// Getrennt von `lib/live.js`, damit die Suchlogik dort ohne Postgres
// durchgerechnet werden kann (dieselbe Trennung wie loginbonus/ledger).

import { sql } from "./db";
import { kbFetch } from "./kickbase";
import { LIVE_PFADE, besterFund, sammleTreffer } from "./live";

// Der Pfad, der zuletzt funktioniert hat. Ist er bekannt, kostet ein
// Seitenaufruf **einen** Kickbase-Request statt elf.
export async function bekannterLivePfad() {
  const r = await sql`SELECT daten FROM pool_cache WHERE id = 'live_pfad'`;
  return r[0]?.daten ?? null;
}

async function merke(daten) {
  const inhalt = JSON.stringify({ ...daten, seit: new Date() });
  await sql`
    INSERT INTO pool_cache (id, daten) VALUES ('live_pfad', ${inhalt}::jsonb)
    ON CONFLICT (id) DO UPDATE SET daten = ${inhalt}::jsonb`;
}

// Sucht den Endpunkt. Elf Anfragen, deshalb nur auf ausdrücklichen Klick
// und nicht beim Rendern einer Seite.
export async function sucheLivePfad(leagueId, token, managerIds, uid) {
  const versucht = [];
  for (const pfad of LIVE_PFADE(leagueId, uid)) {
    let daten;
    try {
      daten = await kbFetch(pfad, token);
    } catch (e) {
      versucht.push({ pfad, fehler: e.message });
      continue;
    }
    const fund = besterFund(daten, managerIds);
    if (!fund) {
      versucht.push({ pfad, fehler: "keine Manager-IDs mit Punkten" });
      continue;
    }
    await merke({ pfad, liste: fund.pfad, idFeld: fund.idFeld, punkteFeld: fund.punkteFeld });
    // Nicht spreizen: `fund.pfad` ist die **Liste** in der Antwort und
    // würde den Endpunkt-Pfad überschreiben.
    return {
      gefunden: {
        pfad,
        liste: fund.pfad,
        idFeld: fund.idFeld,
        punkteFeld: fund.punkteFeld,
        manager: fund.abdeckung,
      },
      versucht,
    };
  }
  return { gefunden: null, versucht };
}

// Der Live-Stand über den bekannten Pfad. Ein Aufruf.
//
// Gibt `null` zurück, wenn kein Pfad bekannt ist oder die Antwort die
// Manager-IDs nicht mehr trägt — dann sagt die Seite das, statt Nullen
// als Ergebnis auszugeben.
export async function holeLivestand(leagueId, token, managerIds, kaderIds = new Map()) {
  const merkzettel = await bekannterLivePfad();
  if (!merkzettel?.pfad) return null;

  let daten;
  try {
    daten = await kbFetch(merkzettel.pfad, token);
  } catch (e) {
    return { fehler: e.message, pfad: merkzettel.pfad };
  }

  const fund = besterFund(daten, managerIds);
  if (!fund) return { fehler: "Antwort trägt keine Manager-Punkte", pfad: merkzettel.pfad };

  // Punkte je Spieler, falls die Antwort sie mitführt. Gesucht wird mit
  // den Spieler-IDs aus dem gespeicherten Kader — derselbe Anker wie oben.
  //
  // **Einmal** über alle Spieler suchen und danach den Managern zuordnen.
  // Je Manager zu suchen liefe achtzehnmal durch denselben Baum und fände
  // achtzehnmal dieselbe Liste.
  const alleIds = [...kaderIds.values()].flat();
  const proSpieler = alleIds.length > 0 ? sammleTreffer(daten, alleIds)?.treffer ?? null : null;

  const spieler = new Map();
  if (proSpieler) {
    for (const [managerId, ids] of kaderIds) {
      const eigene = new Map();
      for (const id of ids ?? []) {
        if (proSpieler.has(String(id))) eigene.set(String(id), proSpieler.get(String(id)));
      }
      if (eigene.size) spieler.set(managerId, eigene);
    }
  }

  return {
    pfad: merkzettel.pfad,
    punkteFeld: fund.punkteFeld,
    punkte: fund.treffer,
    spieler,
    stand: new Date(),
  };
}
