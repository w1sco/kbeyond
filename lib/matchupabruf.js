import { sql } from "./db.js";
import { kbFetch } from "./kickbase.js";
import { holePool } from "./rekonstruktion.js";
import { leseLeistungen } from "./spielplan.js";
import { werIstOffen } from "./matchup.js";

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
//   - **Ein Bündel je Request, der Browser fasst nach** — derselbe Weg wie
//     beim Startelf-Abruf. Abbrechen kostet nichts.
const ZEITBUDGET_MS = 45_000;

// Alles, was die Auswertung und der Abruf brauchen, aus der Datenbank.
export async function ladeGrundlage() {
  const [partien, pool, geprueft] = await Promise.all([
    sql`SELECT mi, spieltag, heim, gast, datum, tore_heim, tore_gast FROM spiele`,
    holePool(),
    sql`SELECT player_id, geprueft FROM leistung_geprueft`,
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
  for (const s of pool.spieler ?? []) {
    const id = String(s.id);
    const team = s.teamId == null ? null : String(s.teamId);
    if (s.position) position.set(id, s.position);
    if (!team) continue;
    if (!kader.has(team)) kader.set(team, []);
    kader.get(team).push(id);
    if (s.verein && !vereine.has(team)) vereine.set(team, s.verein);
  }

  const geprueftAm = new Map(
    geprueft.map((z) => [String(z.player_id), new Date(z.geprueft).getTime()]));

  return { spiele, kader, position, vereine, geprueftAm, poolLeer: pool.leer };
}

export async function importiereLeistungen(token) {
  const g = await ladeGrundlage();
  const offen = werIstOffen(g);
  if (offen.length === 0) return { geholt: 0, offen: 0 };

  const start = Date.now();
  let geholt = 0;
  let zeilen = 0;

  for (const pid of offen) {
    if (Date.now() - start > ZEITBUDGET_MS) break;

    let leistungen = [];
    try {
      const daten = await kbFetch(`/v4/competitions/1/players/${pid}/performance`, token);
      // Nur Partien mit Punkten: Wer nicht gespielt hat, trägt nichts bei,
      // und eine kommende Partie steht ohne `p` in der Reihe.
      leistungen = leseLeistungen(daten).filter((l) => l.punkte != null);
    } catch (e) {
      if (e?.gedrosselt) throw e;
      // Nur ein 404 gilt als beantwortet. Bei allem anderen wäre der
      // Vermerk gelogen — der Spieler kommt beim nächsten Bündel wieder dran.
      if (e?.status !== 404) continue;
    }

    if (leistungen.length > 0) {
      const pos = g.position.get(pid) ?? null;
      await sql`
        INSERT INTO spieler_punkte (player_id, mi, team_id, spieltag, punkte, position)
        SELECT ${pid}::text, t.mi, t.team, t.tag, t.p, ${pos}::text FROM UNNEST(
          ${leistungen.map((l) => l.mi)}::text[],
          ${leistungen.map((l) => l.team)}::text[],
          ${leistungen.map((l) => l.spieltag)}::int[],
          ${leistungen.map((l) => l.punkte)}::int[]
        ) AS t(mi, team, tag, p)
        ON CONFLICT (player_id, mi) DO UPDATE SET
          team_id = EXCLUDED.team_id,
          spieltag = EXCLUDED.spieltag,
          punkte = EXCLUDED.punkte,
          position = COALESCE(EXCLUDED.position, spieler_punkte.position)`;
      zeilen += leistungen.length;
    }

    await sql`
      INSERT INTO leistung_geprueft (player_id, geprueft)
      VALUES (${pid}, NOW())
      ON CONFLICT (player_id) DO UPDATE SET geprueft = NOW()`;
    geholt++;
  }

  return { geholt, zeilen, offen: offen.length - geholt };
}

// Wie weit ist der Abruf? `offen` ist die Zahl, an der der Browser merkt,
// ob er noch einmal nachfassen muss.
export async function standLeistungen() {
  const g = await ladeGrundlage();
  let gesamt = 0;
  for (const ids of g.kader.values()) gesamt += ids.length;
  return {
    gesamt,
    offen: werIstOffen(g).length,
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
