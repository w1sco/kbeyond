import { kbFetch } from "./kickbase";
import { sql, merkeMarktwerte } from "./db";
import { findeSpielerListe, normalisiereSpieler, mwTag } from "./format";
import { LINEUP_PFADE, elfAus } from "./aufstellung";
import { holeNamen, benenne } from "./spielernamen";

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Lädt für jeden Manager den Kader und legt ihn ab. Damit weiß die Liga,
// welche Spieler vergeben sind — und die Managerseite kommt ohne einen
// Live-Abruf je Seitenaufruf aus.
export async function ladeKader(leagueId, managerIds, token, opt = {}) {
  const { frist = Date.now() + 45_000 } = opt;

  // Alle Ablesungen dieses Laufs gehören auf denselben Marktwert-Tag,
  // auch wenn der Lauf über die 22:04-Grenze hinweg läuft.
  const tag = mwTag(new Date());

  // Einmal für alle Manager: der Kader-Endpoint liefert keine Namen.
  const namen = await holeNamen(leagueId);

  // Altbestand aufräumen: Kader, die bei einem früheren Lauf ohne Namen
  // gespeichert wurden und diesmal nicht neu geschrieben werden (weil der
  // Abruf scheitert), bekommen ihre Namen trotzdem.
  await sql`
    UPDATE kader k SET name = e.name
    FROM (
      SELECT player_id, MAX(player_name) AS name FROM events
      WHERE league_id = ${leagueId} AND player_id IS NOT NULL AND player_name IS NOT NULL
      GROUP BY player_id
    ) e
    WHERE k.league_id = ${leagueId} AND k.player_id = e.player_id
      AND (k.name IS NULL OR k.name = 'Unbekannt')`;

  let geladen = 0;
  let ohneNamen = 0;
  let fehler = 0;
  let spieler = 0;
  let leer = 0;
  // Wen es betrifft, nicht nur wie viele – ohne Namen kann man nicht
  // nachsehen, was bei diesem Manager anders ist.
  const leereManager = [];

  for (const uid of managerIds) {
    // Vercel bricht bei 60 s hart ab – vorher kontrolliert aussteigen.
    if (Date.now() > frist) {
      return { geladen, spieler, leer, ohneNamen, fehler, leereManager, gesamt: managerIds.length, gestoppt: true };
    }

    try {
      const antwort = await kbFetch(`/v4/leagues/${leagueId}/managers/${uid}/squad`, token);
      const roheListe = findeSpielerListe(antwort);

      // ── Keine geratene Aufstellung mehr ──────────────────────────
      //
      // Hier stand eine Felderkennung: Sie suchte im Kader ein Feld, das
      // eine passende Zahl Spieler auszeichnet. Das ging schief, und zwar
      // plausibel aussehend — der gespeicherte Kader ist nach Marktwert
      // sortiert, also traf ein zufällig passendes Feld reihenweise die
      // teuersten Spieler. Herausgekommen sind Aufstellungen mit zwei
      // Torhütern und „die teuerste Elf", die niemand so aufgestellt hat.
      //
      // Eine falsche Aufstellung ist schlimmer als keine: Nach ihr trifft
      // jemand Entscheidungen. Geschrieben wird `aufgestellt` deshalb nur
      // noch aus dem belegten Endpunkt (ladeAufstellungen).
      const startelf = null;

      const liste = roheListe.map((roh, i) => {
        const s = normalisiereSpieler(roh);
        const name = benenne(s, namen);
        if (name.startsWith("Spieler #")) ohneNamen++;
        return { ...s, name, aufgestellt: startelf ? startelf[i] : null };
      });

      if (liste.length === 0) {
        leer++;
        leereManager.push(String(uid));
      } else {
        // Erst löschen, dann schreiben: verkaufte Spieler sollen verschwinden.
        await sql`DELETE FROM kader WHERE league_id = ${leagueId} AND manager_id = ${String(uid)}`;
        await sql`
          INSERT INTO kader (league_id, manager_id, player_id, name, position, marktwert, kaufpreis, punkte, aufgestellt, stand)
          SELECT ${leagueId}::text, ${String(uid)}::text, *, NOW() FROM UNNEST(
            ${liste.map((s) => String(s.id))}::text[],
            ${liste.map((s) => s.name)}::text[],
            ${liste.map((s) => s.position)}::text[],
            ${liste.map((s) => Number(s.marktwert ?? 0))}::bigint[],
            ${liste.map((s) => (s.preis == null ? null : Number(s.preis)))}::bigint[],
            ${liste.map((s) => (s.punkte == null ? null : Number(s.punkte)))}::int[],
            ${liste.map((s) => s.aufgestellt)}::boolean[]
          )
          ON CONFLICT (league_id, manager_id, player_id) DO NOTHING`;

        // Marktwerte für den laufenden Marktwert-Tag mitschreiben. Daraus
        // entsteht der Trend: derselbe Spieler an zwei Tagen verglichen.
        // Der Kader selbst wird überschrieben und trägt keine Historie.
        await merkeMarktwerte(liste, tag);

        spieler += liste.length;
        geladen++;

        // Die echte Kadergröße ist mehr wert als dashboard.t
        await sql`
          UPDATE teamwerte SET spieler = ${liste.length}
          WHERE league_id = ${leagueId} AND manager_id = ${String(uid)}`;
      }
    } catch (e) {
      // Drosselung betrifft den ganzen Lauf, nicht nur diesen Manager
      if (e.gedrosselt) throw e;
      // Sonst überspringen, der Rest soll trotzdem durchlaufen
      fehler++;
    }
    await schlaf(200);
  }

  return { geladen, spieler, leer, ohneNamen, fehler, leereManager, gesamt: managerIds.length, gestoppt: false };
}


// ── Die echte Aufstellung über den eigenen Endpunkt ─────────────────
//
// `/v4/leagues/{id}/lineup` ist belegt und liefert die Startelf mit `lo`.
// Ob es eine Fassung je Manager gibt, entscheidet sich beim ersten
// Versuch: Greift eine Variante mit `uid`, holen wir jede Aufstellung
// einzeln. Sonst gibt es genau einen Abruf, und die Spieler werden dem
// Manager zugeordnet, in dessen Kader sie stehen — wer die Spieler hat,
// hat die Aufstellung.
export async function ladeAufstellungen(leagueId, token, managerIds, opt = {}) {
  const { frist = Date.now() + 20_000 } = opt;
  if (managerIds.length === 0) return { manager: 0, art: null, pfad: null, eigenstaendig: true };

  const holen = async (pfad) => {
    try {
      return elfAus(await kbFetch(pfad, token));
    } catch (e) {
      if (e.gedrosselt) throw e;
      return null;
    }
  };

  // Welche Form funktioniert? Einmal am ersten Manager herausfinden.
  let vorlage = null;
  let mitUid = false;
  for (const pfad of LINEUP_PFADE(leagueId, managerIds[0])) {
    const r = await holen(pfad);
    if (r?.ids?.size) {
      vorlage = r;
      mitUid = pfad.includes(String(managerIds[0]));
      break;
    }
  }
  if (!vorlage) return { manager: 0, art: null, pfad: null, eigenstaendig: true };

  // Die Spieler dem Manager zuordnen, in dessen Kader sie stehen. Wer die
  // Spieler hat, hat die Aufstellung — wessen Aufstellung der Endpunkt
  // liefert, muss man so nicht wissen.
  const setzen = async (ids) => {
    if (!ids?.size) return 0;
    const r = await sql`
      UPDATE kader SET aufgestellt = (player_id = ANY(${[...ids]}::text[]))
      WHERE league_id = ${leagueId}
        AND manager_id IN (
          SELECT DISTINCT manager_id FROM kader
          WHERE league_id = ${leagueId} AND player_id = ANY(${[...ids]}::text[])
        )
      RETURNING manager_id`;
    return new Set(r.map((z) => String(z.manager_id))).size;
  };

  if (!mitUid) {
    const betroffen = await setzen(vorlage.ids);
    return { manager: betroffen, art: vorlage.art, pfad: "ligaweit", eigenstaendig: true };
  }

  // Je Manager — aber mit Gegenprobe: Ein Endpunkt, der die `uid` ignoriert
  // und immer dieselbe Elf liefert, sähe sonst nach 17 Erfolgen aus, obwohl
  // nur ein einziger Manager Daten bekommt.
  const gesehen = new Set();
  let manager = 0;

  for (const uid of managerIds) {
    if (Date.now() > frist) break;
    let r = null;
    for (const pfad of LINEUP_PFADE(leagueId, uid)) {
      if (!pfad.includes(String(uid))) continue;
      r = await holen(pfad);
      if (r?.ids?.size) break;
    }
    if (!r?.ids?.size) continue;

    const schluessel = [...r.ids].sort().join(",");
    if (gesehen.has(schluessel)) continue; // dieselbe Elf wie zuvor
    gesehen.add(schluessel);

    manager += await setzen(r.ids);
    await schlaf(200);
  }

  return {
    manager,
    art: vorlage.art,
    pfad: "je Manager",
    // Kamen bei mehreren Managern verschiedene Elfen zurück, wertet der
    // Endpunkt die uid wirklich aus.
    eigenstaendig: gesehen.size > 1 || managerIds.length === 1,
  };
}
