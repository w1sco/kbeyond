// Live-Punkte holen — der Teil, der Datenbank und Kickbase anfasst.
//
// Getrennt von `lib/live.js`, damit die Suchlogik dort ohne Postgres
// durchgerechnet werden kann (dieselbe Trennung wie loginbonus/ledger).

import { sql } from "./db";
import { kbFetch } from "./kickbase";
import { schluesselBaum } from "./aufstellung";
import {
  LIVE_PFADE, besterFund, sammleTreffer, spielerImEintrag, idListeImEintrag,
  feldMitSumme, spielerObjekte, idAus,
} from "./live";

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

  // ── Die Aufstellung aus der Antwort ───────────────────────────────
  //
  // Der Managereintrag trägt unter `lp` die Spieler-IDs seiner Elf. Das
  // ist die **aktuelle** Aufstellung — besser als unser gespeicherter
  // Stand, der einen Tag alt sein kann.
  const aufstellung = new Map();
  for (const [managerId, eintrag] of fund.eintraege ?? []) {
    const ids = idListeImEintrag(eintrag);
    if (ids.length) aufstellung.set(managerId, ids);
  }

  // Zweiter Weg für die Punkte, falls die Antwort die Spieler nicht beim
  // Manager führt, sondern in einer eigenen Liste. Gesucht wird mit den
  // IDs aus der Antwort selbst (`lp`) **und** denen aus dem gespeicherten
  // Kader — die aus der Antwort sind der bessere Anker, weil sie sicher
  // in derselben Schreibweise vorliegen.
  //
  // **Einmal** suchen und danach zuordnen — je Manager zu suchen liefe
  // achtzehnmal durch denselben Baum.
  if (spieler.size === 0) {
    const alleIds = [
      ...new Set([...aufstellung.values(), ...kaderIds.values()].flat().map(String)),
    ];
    const gesammelt = alleIds.length > 0 ? sammleTreffer(daten, alleIds) : null;
    if (gesammelt) {
      const quelle = aufstellung.size > 0 ? aufstellung : kaderIds;
      for (const [managerId, ids] of quelle) {
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
    spieler.size === 0
      ? {
          eintrag: [...(fund.eintraege ?? new Map()).values()][0] ?? null,
          // Dazu der Aufbau der **ganzen** Antwort. Ein einzelner
          // Managereintrag beantwortet nicht, ob die Einzelpunkte
          // woanders stehen.
          baum: schluesselBaum(daten)
            .filter((z) => !/\[\]\./.test(z.pfad.slice(z.pfad.indexOf("[]") + 2)))
            .slice(0, 60),
        }
      : null;

  return {
    pfad: merkzettel.pfad,
    punkteFeld: fund.punkteFeld,
    punkte: fund.treffer,
    aufstellung,
    probe,
    spieler,
    stand: new Date(),
  };
}

// ── Wo stehen die Punkte je Spieler? ────────────────────────────────
//
// An echten Daten belegt: Der Live-Endpunkt liefert je Manager `mdp`
// (seine Spieltagspunkte) und `lp` (die IDs seiner Elf) — **keine Punkte
// je Spieler**. Die müssen woanders herkommen.
//
// Der erste Anlauf suchte nach einer Liste mit mindestens zwei bekannten
// Spieler-IDs. Das konnte für einen Endpunkt, der **einen** Spieler
// beschreibt, nie zutreffen — ein Denkfehler.
//
// Es gibt aber eine harte Prüfgröße, dieselbe Idee wie die Kalibrierung
// des Kontostands: **Die Summe der Elf muss `mdp` ergeben.** Ein Feld,
// das das trifft, ist bewiesen und nicht geraten. Ein Feld, das zufällig
// so heißt, fällt durch.
const SUMMEN_PFADE = (liga, uid) => [
  // Der Kader ist der aussichtsreichste: ein Aufruf je Manager, und wir
  // holen ihn beim Aktualisieren ohnehin schon.
  `/v4/leagues/${liga}/managers/${uid}/squad`,
  `/v4/leagues/${liga}/managers/${uid}/players`,
  `/v4/leagues/${liga}/managers/${uid}/live`,
];

// Probiert die Kandidaten für **einen** Manager durch und prüft jeden
// gegen seine bekannte Spieltagssumme. Läuft nur auf Klick.
export async function sucheSpielerPunkte(leagueId, token, uid, elfIds, soll) {
  const versucht = [];
  if (!uid || !elfIds?.length || !soll) {
    return { gefunden: null, versucht, grund: "keine Elf oder keine Summe zum Prüfen" };
  }

  for (const pfad of SUMMEN_PFADE(leagueId, uid)) {
    let daten;
    try {
      daten = await kbFetch(pfad, token);
    } catch (e) {
      versucht.push({ pfad, fehler: e.message });
      continue;
    }

    const { treffer, geprueft, gefunden } = feldMitSumme(daten, elfIds, soll);
    if (treffer) {
      const alt = (await bekannterLivePfad()) ?? {};
      await merke({ ...alt, spielerPfad: pfad, spielerFeld: treffer.feld });
      return { gefunden: { pfad, feld: treffer.feld, summe: treffer.summe, soll }, versucht };
    }
    versucht.push({
      pfad,
      fehler: `${gefunden} Spieler gefunden, kein Feld summiert auf ${soll}`,
      geprueft,
    });
  }

  return { gefunden: null, versucht };
}

// Die Einzelpunkte über den bewiesenen Pfad holen: ein Aufruf je Manager.
// Läuft deshalb nur auf Klick, nie beim Rendern.
export async function holeSpielerPunkte(leagueId, token, managerIds, aufstellung) {
  const merkzettel = await bekannterLivePfad();
  if (!merkzettel?.spielerPfad || !merkzettel?.spielerFeld) return null;

  const raus = new Map();
  for (const uid of managerIds) {
    const pfad = merkzettel.spielerPfad.replace(/managers\/[^/]+/, `managers/${uid}`);
    let daten;
    try {
      daten = await kbFetch(pfad, token);
    } catch {
      continue;
    }
    const elf = new Set((aufstellung.get(String(uid)) ?? []).map(String));
    const eigene = new Map();
    for (const o of spielerObjekte(daten)) {
      const id = idAus(o);
      if (!id || (elf.size > 0 && !elf.has(id))) continue;
      const wert = Number(o[merkzettel.spielerFeld]);
      if (Number.isFinite(wert)) eigene.set(id, { punkte: wert, roh: o });
    }
    if (eigene.size) raus.set(String(uid), eigene);
  }
  return raus;
}

// Die geholten Einzelpunkte liegen in `pool_cache`, damit ein
// Seitenaufruf sie lesen kann, ohne je Manager einen Aufruf zu kosten.
export async function speichereSpielerPunkte(leagueId, proManager) {
  const inhalt = JSON.stringify({
    stand: new Date(),
    manager: Object.fromEntries(
      [...proManager].map(([mid, spieler]) => [
        mid,
        Object.fromEntries([...spieler].map(([pid, e]) => [pid, e.punkte])),
      ])
    ),
  });
  const id = `live_punkte_${leagueId}`;
  await sql`
    INSERT INTO pool_cache (id, daten) VALUES (${id}, ${inhalt}::jsonb)
    ON CONFLICT (id) DO UPDATE SET daten = ${inhalt}::jsonb`;
}

export async function gespeicherteSpielerPunkte(leagueId) {
  const r = await sql`SELECT daten FROM pool_cache WHERE id = ${`live_punkte_${leagueId}`}`;
  const d = r[0]?.daten;
  if (!d?.manager) return null;
  const raus = new Map();
  for (const [mid, spieler] of Object.entries(d.manager)) {
    raus.set(mid, new Map(Object.entries(spieler).map(([pid, p]) => [pid, { punkte: p, roh: null }])));
  }
  return { stand: d.stand, proManager: raus };
}
