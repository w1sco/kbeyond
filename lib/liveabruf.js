// Live-Punkte holen — der Teil, der Datenbank und Kickbase anfasst.
//
// Getrennt von `lib/live.js`, damit die Suchlogik dort ohne Postgres
// durchgerechnet werden kann (dieselbe Trennung wie loginbonus/ledger).

import { sql } from "./db";
import { kbFetch } from "./kickbase";
import { LIVE_PFADE, besterFund, sammleTreffer, spielerImEintrag } from "./live";

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

  // ── Punkte je Spieler ─────────────────────────────────────────────
  //
  // Erster und bester Weg: **im Eintrag des Managers selbst** nachsehen.
  // Was dort als Liste mit ID und Punktzahl steht, sind seine Spieler —
  // das kommt ohne unseren gespeicherten Kader aus und trägt deshalb auch
  // dann, wenn der einen Transfer alt ist.
  const spieler = new Map();
  for (const [managerId, eintrag] of fund.eintraege ?? []) {
    const gefunden = spielerImEintrag(eintrag, fund.punkteFeld);
    if (!gefunden) continue;
    spieler.set(
      managerId,
      new Map(gefunden.spieler.map((s) => [s.id, { punkte: s.punkte, roh: s.roh }]))
    );
  }

  // Zweiter Weg, falls die Antwort die Spieler nicht beim Manager führt,
  // sondern in einer eigenen Liste: über die Spieler-IDs aus dem
  // gespeicherten Kader. **Einmal** suchen und danach zuordnen — je
  // Manager zu suchen liefe achtzehnmal durch denselben Baum.
  if (spieler.size === 0) {
    const alleIds = [...kaderIds.values()].flat();
    const gesammelt = alleIds.length > 0 ? sammleTreffer(daten, alleIds) : null;
    if (gesammelt) {
      for (const [managerId, ids] of kaderIds) {
        const eigene = new Map();
        for (const id of ids ?? []) {
          const schluessel = String(id);
          if (gesammelt.treffer.has(schluessel)) {
            eigene.set(schluessel, {
              punkte: gesammelt.treffer.get(schluessel),
              roh: gesammelt.eintraege.get(schluessel) ?? null,
            });
          }
        }
        if (eigene.size) spieler.set(managerId, eigene);
      }
    }
  }

  // Wurde nichts gefunden, geben wir **einen Managereintrag im Rohzustand**
  // mit. Die Antwort liegt ohnehin vor; das kostet keinen zusätzlichen
  // Aufruf und beantwortet die Frage, woran es liegt — statt sie über eine
  // Diagnoseseite mit vierzehn Aufrufen zu stellen.
  const probe =
    spieler.size === 0 ? [...(fund.eintraege ?? new Map()).values()][0] ?? null : null;

  return {
    pfad: merkzettel.pfad,
    punkteFeld: fund.punkteFeld,
    punkte: fund.treffer,
    probe,
    spieler,
    stand: new Date(),
  };
}
