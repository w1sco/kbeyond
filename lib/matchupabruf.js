import { sql } from "./db.js";
import { kbFetch } from "./kickbase.js";
import { holePool } from "./rekonstruktion.js";
import { leseLeistungen, aktuelleSaison } from "./spielplan.js";
import { werIstOffen, teileAuf, letzteEnden } from "./matchup.js";

// Die Punkte je Spieler und Partie holen — für die Matchup-Seite.
//
// **Das ist teuer: ein Aufruf je Spieler**, `/v4/competitions/1/players/
// {pid}/performance`. Einen Endpunkt, der alle Punkte einer Partie auf
// einmal liefert, kennen wir nicht. Deshalb:
//
//   - **Nie im Aktualisieren-Lauf**, nur über einen eigenen Knopf.
//   - **Nur wer nachgespielt hat:** gefragt wird, wessen Verein seit der
//     letzten Abfrage eine Partie beendet hat. Nach einem vollen Spieltag
//     sind das alle, nach einem Freitagsspiel zwei Vereine.
//   - **Und davon nur, wer gepunktet hat:** Wessen Saisonpunkte in der
//     Spielerliste sich nicht bewegt haben, wird ohne Aufruf abgehakt
//     (teileAuf() in lib/matchup.js, mit den Bedingungen dafür).
//   - **Ein Bündel je Request, der Browser fasst nach** — derselbe Weg wie
//     beim Startelf-Abruf. Abbrechen kostet nichts.
const ZEITBUDGET_MS = 45_000;

// Alles, was die Auswertung und der Abruf brauchen, aus der Datenbank.
export async function ladeGrundlage() {
  const [partien, pool, geprueft] = await Promise.all([
    sql`SELECT mi, spieltag, heim, gast, datum, tore_heim, tore_gast FROM spiele`,
    holePool(),
    sql`SELECT player_id, geprueft, tp, tp_passt FROM leistung_geprueft`,
  ]);

  const spiele = partien
    .filter((z) => z.mi)
    .map((z) => ({
      mi: String(z.mi),
      spieltag: z.spieltag == null ? null : Number(z.spieltag),
      heim: String(z.heim),
      gast: String(z.gast),
      datum: z.datum ? new Date(z.datum).toISOString() : null,
      gewertet: z.tore_heim != null && z.tore_gast != null,
    }));

  // Heutige Kader der Vereine, Positionen und Vereinsnamen aus dem Pool.
  const kader = new Map();
  const position = new Map();
  const vereine = new Map();
  const teamVon = new Map();
  const tpJetzt = new Map();
  for (const s of pool.spieler ?? []) {
    const id = String(s.id);
    const team = s.teamId == null ? null : String(s.teamId);
    if (s.position) position.set(id, s.position);
    if (typeof s.saisonpunkte === "number") tpJetzt.set(id, s.saisonpunkte);
    if (team) teamVon.set(id, team);
    if (!team) continue;
    if (!kader.has(team)) kader.set(team, []);
    kader.get(team).push(id);
    if (s.verein && !vereine.has(team)) vereine.set(team, s.verein);
  }

  const geprueftAm = new Map();
  const tpDamals = new Map();
  const tpPasst = new Map();
  for (const z of geprueft) {
    const id = String(z.player_id);
    geprueftAm.set(id, new Date(z.geprueft).getTime());
    if (z.tp != null) tpDamals.set(id, Number(z.tp));
    tpPasst.set(id, z.tp_passt === true);
  }

  return {
    spiele, kader, position, vereine, teamVon, geprueftAm,
    tpJetzt, tpDamals, tpPasst,
    poolStand: pool.stand ? new Date(pool.stand).getTime() : null,
    poolLeer: pool.leer,
  };
}

// Offen, aufgeteilt in „braucht einen Aufruf“ und „ohne neue Punkte“.
function planen(g, jetzt = Date.now()) {
  const offen = werIstOffen({ ...g, jetzt });
  return teileAuf({ ...g, offen, letztesEnde: letzteEnden(g.spiele, jetzt) });
}

// Summe aller Punkte der laufenden Saison aus einer Leistungsreihe — der
// Vergleichswert zu `tp` aus der Spielerliste.
function saisonSumme(daten) {
  const reihe = aktuelleSaison(daten)?.ph ?? [];
  return reihe.reduce((s, e) => s + (typeof e?.p === "number" ? e.p : 0), 0);
}

// `melde` bekommt nach jedem Spieler den Zwischenstand — die Route reicht
// ihn als Zeile an den Browser weiter. `abbruch` ist das Signal der
// Anfrage: Klickt jemand auf Abbrechen, hört der Lauf nach dem laufenden
// Spieler auf, statt sein Zeitbudget auszuschöpfen.
export async function importiereLeistungen(token, { melde = () => {}, abbruch = null } = {}) {
  const g = await ladeGrundlage();
  const { fragen, ueberspringen } = planen(g);

  // Ohne neue Punkte: abhaken, ohne Kickbase zu fragen. Die gemerkten
  // Saisonpunkte bleiben, sie stimmen ja weiter.
  if (ueberspringen.length > 0) {
    await sql`
      UPDATE leistung_geprueft SET geprueft = NOW()
      WHERE player_id = ANY(${ueberspringen}::text[])`;
  }
  if (fragen.length === 0) {
    return { geholt: 0, uebersprungen: ueberspringen.length, offen: 0 };
  }

  const start = Date.now();
  let geholt = 0;
  // Geschrieben wird **nach jedem Spieler**, nicht gesammelt am Ende. Das
  // kostet keine Zeit: Die Bremse zählt ab dem Start des letzten Aufrufs,
  // das Schreiben fällt also in die 600 ms, die ohnehin gewartet werden.
  // Und ein Abbruch verliert nichts, was schon geholt war.
  const zeilen = [];
  const vermerke = [];

  async function schreiben() {
    if (zeilen.length > 0) {
      await sql`
        INSERT INTO spieler_punkte (player_id, mi, team_id, spieltag, punkte, position)
        SELECT * FROM UNNEST(
          ${zeilen.map((z) => z.pid)}::text[],
          ${zeilen.map((z) => z.mi)}::text[],
          ${zeilen.map((z) => z.team)}::text[],
          ${zeilen.map((z) => z.spieltag)}::int[],
          ${zeilen.map((z) => z.punkte)}::int[],
          ${zeilen.map((z) => z.position)}::text[]
        ) AS t(player_id, mi, team_id, spieltag, punkte, position)
        ON CONFLICT (player_id, mi) DO UPDATE SET
          team_id = EXCLUDED.team_id,
          spieltag = EXCLUDED.spieltag,
          punkte = EXCLUDED.punkte,
          position = COALESCE(EXCLUDED.position, spieler_punkte.position)`;
      zeilen.length = 0;
    }
    if (vermerke.length > 0) {
      await sql`
        INSERT INTO leistung_geprueft (player_id, geprueft, tp, tp_passt)
        SELECT t.pid, NOW(), t.tp, t.passt FROM UNNEST(
          ${vermerke.map((v) => v.pid)}::text[],
          ${vermerke.map((v) => v.tp)}::int[],
          ${vermerke.map((v) => v.passt)}::boolean[]
        ) AS t(pid, tp, passt)
        ON CONFLICT (player_id) DO UPDATE SET
          geprueft = NOW(), tp = EXCLUDED.tp, tp_passt = EXCLUDED.tp_passt`;
      vermerke.length = 0;
    }
  }

  try {
    for (const pid of fragen) {
      if (Date.now() - start > ZEITBUDGET_MS) break;
      if (abbruch?.aborted) break;

      let daten = null;
      try {
        daten = await kbFetch(`/v4/competitions/1/players/${pid}/performance`, token);
      } catch (e) {
        if (e?.gedrosselt) throw e;
        // Nur ein 404 gilt als beantwortet. Bei allem anderen wäre der
        // Vermerk gelogen — der Spieler kommt beim nächsten Bündel dran.
        if (e?.status !== 404) continue;
      }

      const tp = g.tpJetzt.get(pid) ?? null;
      if (daten) {
        const pos = g.position.get(pid) ?? null;
        // Nur Partien mit Punkten: Wer nicht gespielt hat, trägt nichts bei,
        // und eine kommende Partie steht ohne `p` in der Reihe.
        for (const l of leseLeistungen(daten)) {
          if (l.punkte == null) continue;
          zeilen.push({ pid, ...l, position: pos });
        }
        // Belegt das `tp` der Spielerliste für diesen Spieler die Summe
        // seiner Spiele? Nur dann darf er später übersprungen werden.
        vermerke.push({ pid, tp, passt: tp != null && saisonSumme(daten) === tp });
      } else {
        vermerke.push({ pid, tp: null, passt: false });
      }
      await schreiben();
      geholt++;
      melde({ geholt, zuFragen: fragen.length, uebersprungen: ueberspringen.length });
    }
  } finally {
    // Falls ein Fehler zwischen Holen und Schreiben kam
    await schreiben();
  }

  return { geholt, uebersprungen: ueberspringen.length, offen: fragen.length - geholt };
}

// Wie weit ist der Abruf? `offen` ist die Zahl, an der der Browser merkt,
// ob er noch einmal nachfassen muss.
export async function standLeistungen() {
  const g = await ladeGrundlage();
  let gesamt = 0;
  for (const ids of g.kader.values()) gesamt += ids.length;
  const { fragen, ueberspringen } = planen(g);
  // Ist die Spielerliste älter als das letzte beendete Spiel, kann niemand
  // übersprungen werden — ihre Saisonpunkte sind noch die von vorher.
  const enden = [...letzteEnden(g.spiele).values()];
  const letztesSpielEnde = enden.length ? Math.max(...enden) : null;
  return {
    gesamt,
    offen: fragen.length + ueberspringen.length,
    zuFragen: fragen.length,
    ohneNeuePunkte: ueberspringen.length,
    listeVeraltet: g.poolStand != null && letztesSpielEnde != null && g.poolStand < letztesSpielEnde,
    gewertet: g.spiele.filter((s) => s.gewertet).length,
    spielplan: g.spiele.length > 0,
  };
}

// Die gespeicherten Punkte je Partie, mit Position.
export async function ladeLeistungen(position) {
  const zeilen = await sql`
    SELECT player_id, mi, team_id, punkte, position FROM spieler_punkte`;
  return zeilen.map((z) => ({
    mi: String(z.mi),
    team: String(z.team_id),
    punkte: Number(z.punkte ?? 0),
    position: z.position ?? position.get(String(z.player_id)) ?? null,
  }));
}
