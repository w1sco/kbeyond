import { sql, naechsterSpieltag } from "./db.js";
import { kbFetch } from "./kickbase.js";
import { holePool } from "./rekonstruktion.js";
import { leseChance } from "./startelf.js";

export { naechsterSpieltag };

// Der **teure** Weg: ein Aufruf je Spieler.
//
// Er läuft nur, wenn der billige nichts hergibt. Vereinskader, Kader und
// Marktangebote werden ohnehin geholt; trägt eine dieser Listen `prob`
// mit, ist die Angabe umsonst da (`ernte()` in lib/startelf.js) und hier
// bleibt nichts zu tun.
//
// Anders als die Leistungsreihe veraltet die Angabe **jede Woche**: `prob`
// beschreibt den kommenden Spieltag. Angehängt wird sie deshalb an die
// Spieltagsnummer, nicht an eine Uhrzeit.
//
// Ein Lauf holt, was in sein Zeitbudget passt — rund 60 Spieler. Der
// Browser ruft wiederholt auf und zeigt den Fortschritt, wie bei den News:
// **ein Klick**, dann läuft es durch. Ein Abbruch kostet nur das laufende
// Bündel, alles davor steht schon in der Datenbank.
const SPIELER_JE_LAUF = 200;
const ZEITBUDGET_MS = 45_000;

// In welcher Reihenfolge gefragt wird.
//
// Wer in einem Kader steht oder gerade am Markt liegt, wird auf den Seiten
// wirklich angesehen — der gehört zuerst geholt. Der lange Schwanz aus
// Ergänzungsspielern, die niemand aufstellt, kommt danach und trickelt
// über mehrere Klicks herein.
async function reihenfolge() {
  const pool = await holePool();
  const alle = (pool.spieler ?? []).map((s) => String(s.id)).filter(Boolean);
  if (alle.length === 0) return [];

  const [imKader, amMarkt] = await Promise.all([
    sql`SELECT DISTINCT player_id FROM kader`,
    sql`SELECT DISTINCT player_id FROM markt_beobachtung WHERE ablauf > NOW()`,
  ]);
  const wichtig = new Set([
    ...imKader.map((z) => String(z.player_id)),
    ...amMarkt.map((z) => String(z.player_id)),
  ]);

  const vorn = alle.filter((id) => wichtig.has(id));
  const hinten = alle.filter((id) => !wichtig.has(id));
  return [...vorn, ...hinten];
}

export async function importiereStartelf(token, { max = SPIELER_JE_LAUF } = {}) {
  const tag = await naechsterSpieltag();
  if (tag == null) return { geholt: 0, offen: 0, hinweis: "kein Spielplan geladen" };

  const alle = await reihenfolge();
  if (alle.length === 0) return { geholt: 0, offen: 0, hinweis: "Spielerliste noch nicht geladen" };

  const fertig = await sql`SELECT player_id FROM startelf WHERE spieltag >= ${tag}`;
  const schonDa = new Set(fertig.map((z) => String(z.player_id)));
  const offen = alle.filter((id) => !schonDa.has(id));
  if (offen.length === 0) return { geholt: 0, offen: 0, tag };

  const start = Date.now();
  let geholt = 0;
  let mitAngabe = 0;

  for (const pid of offen.slice(0, max)) {
    if (Date.now() - start > ZEITBUDGET_MS) break;

    let stufe = null;
    try {
      stufe = leseChance(await kbFetch(`/v4/competitions/1/players/${pid}`, token));
    } catch (e) {
      // Ein Spieler ohne Profil reißt den Lauf nicht mit. Nur ein 404 gilt
      // als beantwortet — bei allem anderen (Drosselung, Ausfall) wäre ein
      // Vermerk gelogen und der Spieler bliebe eine Woche ohne Angabe.
      if (e?.status !== 404) continue;
    }

    await sql`
      INSERT INTO startelf (player_id, stufe, spieltag, stand)
      VALUES (${pid}, ${stufe}, ${tag}, NOW())
      ON CONFLICT (player_id) DO UPDATE
        SET stufe = ${stufe}, spieltag = ${tag}, stand = NOW()`;
    geholt++;
    if (stufe != null) mitAngabe++;
  }

  return { geholt, mitAngabe, offen: offen.length - geholt, tag, gesamt: alle.length };
}

// Für die Anzeige und für den Browser-Lauf: wie weit ist der Abruf?
//
// `offen` ist die Zahl, an der der Browser merkt, ob er noch einmal
// nachfassen muss.
export async function standStartelf() {
  const tag = await naechsterSpieltag();
  if (tag == null) return { tag: null, geprueft: 0, mitAngabe: 0, gesamt: 0, offen: 0 };

  const [r, pool] = await Promise.all([
    sql`SELECT COUNT(*)::int AS geprueft, COUNT(stufe)::int AS mit_angabe
          FROM startelf WHERE spieltag >= ${tag}`,
    holePool(),
  ]);
  const gesamt = (pool.spieler ?? []).length;
  const geprueft = r[0]?.geprueft ?? 0;
  return {
    tag,
    geprueft,
    mitAngabe: r[0]?.mit_angabe ?? 0,
    gesamt,
    offen: Math.max(0, gesamt - geprueft),
  };
}
