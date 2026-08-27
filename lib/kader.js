import { kbFetch } from "./kickbase";
import { sql, merkeMarktwerte } from "./db";
import { findeSpielerListe, normalisiereSpieler, mwTag } from "./format";
import { findeAufstellung } from "./aufstellung";
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
  let mitAufstellung = 0;
  let erkanntAn = null;

  for (const uid of managerIds) {
    // Vercel bricht bei 60 s hart ab – vorher kontrolliert aussteigen.
    if (Date.now() > frist) {
      return { geladen, spieler, leer, ohneNamen, fehler, mitAufstellung, erkanntAn, gesamt: managerIds.length, gestoppt: true };
    }

    try {
      const antwort = await kbFetch(`/v4/leagues/${leagueId}/managers/${uid}/squad`, token);
      const roheListe = findeSpielerListe(antwort);

      // Die echte Startelf, wie sie in Kickbase steht. Welches Feld sie
      // kennzeichnet, ist nicht belegt — findeAufstellung sucht das Feld,
      // bei dem genau elf Spieler markiert sind, und gibt sonst nichts
      // zurück. Lieber keine Aufstellung als eine erfundene.
      const gefunden = findeAufstellung(roheListe);
      const startelf = gefunden?.drin ?? null;
      if (startelf) {
        mitAufstellung++;
        // Woran erkannt? Steht im Ergebnis des Laufs, damit ein Fehlgriff
        // nachvollziehbar ist statt nur „geht nicht".
        erkanntAn = gefunden.feld ? `${gefunden.feld} (${gefunden.art})` : gefunden.art;
      }

      const liste = roheListe.map((roh, i) => {
        const s = normalisiereSpieler(roh);
        const name = benenne(s, namen);
        if (name.startsWith("Spieler #")) ohneNamen++;
        return { ...s, name, aufgestellt: startelf ? startelf[i] : null };
      });

      if (liste.length === 0) {
        leer++;
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

  return { geladen, spieler, leer, ohneNamen, fehler, mitAufstellung, erkanntAn, gesamt: managerIds.length, gestoppt: false };
}
