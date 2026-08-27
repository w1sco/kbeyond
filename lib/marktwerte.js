import { sql } from "./db";
import { kbFetch } from "./kickbase";

// Marktwert eines Spielers zu einem bestimmten Tag.
//
// Gebraucht für den Aufschlag: Kaufpreis minus Marktwert *zum Kaufzeitpunkt*.
// Bisher kam diese Bezugsgröße nur aus dem Feed-Event "Spieler neu am Markt"
// und aus der eigenen Mitschrift — beides fehlt für Käufe, deren Angebot aus
// dem Feed-Fenster gefallen ist. Genau die blieben in der Auswertung außen
// vor: ein Manager mit 11 Spielern erschien mit 7 Käufen.
//
// Kickbase führt zu jedem Spieler eine Marktwert-Historie. Welcher Endpunkt
// sie liefert und unter welchen Feldnamen, ist im Projekt nicht belegt —
// deshalb werden mehrere Kandidaten durchprobiert und die Antwort defensiv
// ausgewertet, statt einen Feldnamen zu raten.

const KANDIDATEN = (lid, pid) => [
  `/v4/leagues/${lid}/players/${pid}/marketValue`,
  `/v4/leagues/${lid}/players/${pid}/marketvalue`,
  `/v4/leagues/${lid}/players/${pid}/marketValues`,
  `/v4/leagues/${lid}/players/${pid}/marketValueHistory`,
  `/v4/leagues/${lid}/players/${pid}/mv`,
  `/v4/leagues/${lid}/players/${pid}/stats`,
  `/v4/leagues/${lid}/players/${pid}/performance`,
  `/v4/leagues/${lid}/players/${pid}`,
  `/v4/competitions/1/players/${pid}/marketvalue`,
  `/v4/competitions/1/players/${pid}`,
];

const DATUMSFELDER = ["dt", "d", "day", "date", "t"];
const WERTFELDER = ["mv", "m", "v", "value", "marketValue"];

function alsDatum(wert) {
  if (wert == null) return null;
  // Zahlen können Sekunden, Millisekunden oder ein Tagesindex sein — nur
  // Werte übernehmen, die als Zeitpunkt plausibel sind.
  if (typeof wert === "number") {
    const ms = wert > 1e11 ? wert : wert * 1000;
    const d = new Date(ms);
    return d.getFullYear() > 2015 && d.getFullYear() < 2100 ? d : null;
  }
  const d = new Date(wert);
  return isNaN(d) || d.getFullYear() < 2015 ? null : d;
}

function alsPunkt(eintrag) {
  if (!eintrag || typeof eintrag !== "object") return null;
  let tag = null;
  for (const k of DATUMSFELDER) {
    tag = alsDatum(eintrag[k]);
    if (tag) break;
  }
  if (!tag) return null;

  for (const k of WERTFELDER) {
    const w = Number(eintrag[k]);
    if (Number.isFinite(w) && w > 0) return { tag, marktwert: Math.round(w) };
  }
  return null;
}

// Sucht in der ganzen Antwort die längste Reihe aus Datum und Wert.
export function findeWertreihe(daten, tiefe = 0) {
  if (!daten || typeof daten !== "object" || tiefe > 6) return [];

  let beste = [];
  const pruefe = (kandidat) => {
    if (kandidat.length > beste.length) beste = kandidat;
  };

  if (Array.isArray(daten)) {
    pruefe(daten.map(alsPunkt).filter(Boolean));
    for (const x of daten) pruefe(findeWertreihe(x, tiefe + 1));
    return beste;
  }

  for (const x of Object.values(daten)) pruefe(findeWertreihe(x, tiefe + 1));
  return beste;
}


// Wie viele Kandidaten dürfen pro Lauf probiert werden?
//
// Die Suche darf Aufrufe kosten, aber verteilt: ein paar je Klick, nicht
// alle auf einmal. Nach wenigen Läufen ist die Liste durch — und dann hört
// die Suche endgültig auf, statt bei jedem Klick erneut ins Leere zu greifen.
const PROBEN_PRO_LAUF = 4;

// Was wurde schon probiert und was kam dabei heraus?
async function versuche() {
  const r = await sql`SELECT daten FROM pool_cache WHERE id = 'mw_versuche'`;
  return r[0]?.daten ?? { probiert: {}, erschoepft: false };
}

async function merkeVersuche(stand) {
  const inhalt = JSON.stringify(stand);
  await sql`
    INSERT INTO pool_cache (id, daten) VALUES ('mw_versuche', ${inhalt}::jsonb)
    ON CONFLICT (id) DO UPDATE SET daten = ${inhalt}::jsonb`;
}

// Welcher Endpunkt hat schon einmal funktioniert? Solange keiner bekannt
// ist, liegt es nicht am Spieler, sondern daran, dass wir nicht wissen, wie
// man fragt — dann darf kein Spieler als "geprüft, nichts da" gesperrt
// werden. Sonst blockiert ein falscher Kandidat die Spieler für Tage.
async function bekannterPfad() {
  const r = await sql`SELECT daten FROM pool_cache WHERE id = 'mw_pfad'`;
  return r[0]?.daten?.pfad ?? null;
}

async function merkePfad(pfad) {
  const inhalt = JSON.stringify({ pfad, seit: new Date() });
  await sql`
    INSERT INTO pool_cache (id, daten) VALUES ('mw_pfad', ${inhalt}::jsonb)
    ON CONFLICT (id) DO UPDATE SET daten = ${inhalt}::jsonb`;
}

// Holt die Historie eines Spielers über den bekannten Pfad. Ein Aufruf.
async function holeUeberPfad(pfad, playerId, token) {
  const reihe = findeWertreihe(await kbFetch(pfad, token));
  if (reihe.length === 0) return 0;

  // Spalten einzeln benennen. Ein früheres "SELECT id, *, *" ergab fünf
  // Spalten für ein dreispaltiges INSERT — der Fehler wurde vom catch der
  // Suche verschluckt und als "Kandidat funktioniert nicht" gewertet.
  await sql`
    INSERT INTO marktwert_verlauf (player_id, tag, marktwert)
    SELECT ${String(playerId)}::text, t.tag, t.marktwert FROM UNNEST(
      ${reihe.map((x) => x.tag.toISOString().slice(0, 10))}::date[],
      ${reihe.map((x) => x.marktwert)}::bigint[]
    ) AS t(tag, marktwert)
    ON CONFLICT (player_id, tag) DO UPDATE SET marktwert = EXCLUDED.marktwert`;

  return reihe.length;
}

// Schrittweise Suche: Welcher Kandidat liefert überhaupt etwas?
//
// Vorher wurden bei jedem Lauf alle Kandidaten durchprobiert — und weil
// keiner passte, jedes Mal aufs Neue. Zehn vergebliche Aufrufe pro Klick,
// für immer. Jetzt merkt sich die Suche, was sie schon probiert hat, nimmt
// je Lauf nur ein paar neue, und hört auf, wenn die Liste durch ist.
async function sondiere(leagueId, playerId, token) {
  const stand = await versuche();
  if (stand.erschoepft) return { pfad: null, erschoepft: true, neu: 0 };

  const offen = KANDIDATEN(leagueId, playerId).filter((pfad) => {
    const schluessel = pfad.replace(/\/players\/[^/]+\//, "/players/*/");
    return !stand.probiert[schluessel];
  });

  let probiert = 0;
  for (const pfad of offen.slice(0, PROBEN_PRO_LAUF)) {
    const schluessel = pfad.replace(/\/players\/[^/]+\//, "/players/*/");
    probiert++;
    try {
      const punkte = await holeUeberPfad(pfad, playerId, token);
      stand.probiert[schluessel] = { punkte, wann: new Date() };
      if (punkte > 0) {
        await merkePfad(pfad);
        await merkeVersuche(stand);
        return { pfad, punkte, neu: probiert };
      }
    } catch (e) {
      if (e.gedrosselt) {
        await merkeVersuche(stand);
        throw e;
      }
      // Ein Fehler beim Speichern ist unser Problem, nicht das des
      // Endpunkts — den Kandidaten dann nicht als untauglich abhaken.
      //
      // Unterschieden am status, den kbFetch setzt, nicht am Wortlaut der
      // Meldung: Ein erster Versuch prüfte auf "HTTP 404", geworfen wird
      // aber "API-Fehler: 404". Damit galt jeder 404 als unser Fehler und
      // riss den ganzen Aktualisieren-Lauf mit.
      if (typeof e.status !== "number") {
        await merkeVersuche(stand);
        throw e;
      }
      stand.probiert[schluessel] = { fehler: e.message, wann: new Date() };
    }
  }

  // Nichts mehr offen? Dann ist der Weg über die Historie tot.
  if (offen.length <= PROBEN_PRO_LAUF) stand.erschoepft = true;
  await merkeVersuche(stand);

  return {
    pfad: null,
    erschoepft: stand.erschoepft,
    neu: probiert,
    restlich: Math.max(0, offen.length - probiert),
  };
}

// Für welche Käufe fehlt der Marktwert noch? Genau die brauchen eine Historie.
export async function spielerOhneMarktwert(leagueId, stichtag, grenze = 25) {
  const zeilen = await sql`
    SELECT DISTINCT k.player_id
    FROM events k
    WHERE k.league_id = ${leagueId} AND k.type = 15 AND k.buyer IS NOT NULL
      AND k.dt >= ${stichtag} AND k.player_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM marktwert_verlauf v
        WHERE v.player_id = k.player_id AND v.tag = k.dt::date
      )
      AND NOT EXISTS (
        SELECT 1 FROM marktwert_geprueft g
        WHERE g.player_id = k.player_id
          AND g.gefunden = 0 AND g.geprueft > NOW() - interval '7 days'
      )
    LIMIT ${grenze}`;
  return zeilen.map((z) => String(z.player_id));
}

// Holt fehlende Historien – sparsam.
//
// Höchstens ein Aufruf je Spieler, höchstens so viele Spieler wie unten
// festgelegt, und nur solange das Zeitbudget reicht. Ist kein Pfad bekannt,
// wird einmal sondiert; klappt das nicht, passiert bis auf Weiteres nichts
// mehr — statt bei jedem Lauf erneut ins Leere zu greifen.
const HOECHSTENS_PRO_LAUF = 10;

export async function ergaenzeMarktwerte(leagueId, token, opt = {}) {
  const { frist = Date.now() + 20_000, stichtag } = opt;

  let pfad = await bekannterPfad();

  // Ohne bekannten Pfad sind alte Sperren wertlos – sie stammen aus einem
  // Versuch, der nie klappen konnte.
  if (!pfad) {
    await sql`DELETE FROM marktwert_geprueft WHERE gefunden = 0`;
  }

  const offen = await spielerOhneMarktwert(leagueId, stichtag, HOECHSTENS_PRO_LAUF);
  if (offen.length === 0) return { geholt: 0, offen: 0, sondiert: false, gestoppt: false };

  let geholt = 0;
  let sondiert = false;

  try {
    if (!pfad) {
      const s = await sondiere(leagueId, offen[0], token);
      sondiert = true;
      if (!s.pfad) {
        return {
          geholt: 0, offen: offen.length, sondiert,
          ohnePfad: true,
          erschoepft: Boolean(s.erschoepft),
          restlich: s.restlich ?? 0,
          geprobt: s.neu ?? 0,
          gestoppt: false,
        };
      }
      pfad = s.pfad;
      geholt++;
    }

    for (const pid of offen) {
      if (Date.now() > frist) {
        return { geholt, offen: offen.length, sondiert, gestoppt: true };
      }
      if (sondiert && pid === offen[0]) continue;

      try {
        const punkte = await holeUeberPfad(pfad.replace(/\/players\/[^/]+\//, `/players/${pid}/`), pid, token);
        if (punkte > 0) geholt++;
        else if (await bekannterPfad()) {
          await sql`
            INSERT INTO marktwert_geprueft (player_id, geprueft, gefunden)
            VALUES (${String(pid)}, NOW(), 0)
            ON CONFLICT (player_id) DO UPDATE SET geprueft = NOW(), gefunden = 0`;
        }
      } catch (e) {
        if (e.gedrosselt) throw e;
      }
    }
  } catch (e) {
    if (e.gedrosselt) {
      return { geholt, offen: offen.length, sondiert, gedrosselt: true, gestoppt: true };
    }
    throw e;
  }

  return { geholt, offen: offen.length, sondiert, gestoppt: false };
}
