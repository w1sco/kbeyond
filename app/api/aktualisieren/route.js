import { initSchema, getSettings, logImport, getImportStatus, sql } from "@/lib/db";
import { kbFetch } from "@/lib/kickbase";
import { importiere } from "@/lib/importer";
import { ladeTeamwerte } from "@/lib/teamwerte";
import { ladeKader } from "@/lib/kader";
import { rekonstruiere } from "@/lib/rekonstruktion";
import { speichereMarkt } from "@/lib/marktbeobachtung";
import { ergaenzeMarktwerte } from "@/lib/marktwerte";
import { pruefeApi, sitzung } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Ein Knopf statt vier. Die Schritte teilen sich ein Zeitbudget: Vercel
// bricht bei 60 s hart ab, und vier Läufe mit je 45 s passen da nicht rein.
// Reicht die Zeit nicht, bleibt der Rest liegen und wird beim nächsten Klick
// fortgesetzt — jeder Schritt merkt sich selbst, wo er stand.
const GESAMTBUDGET_MS = 50_000;

// Unter dieser Restzeit lohnt ein weiterer Schritt nicht mehr.
const MINDESTZEIT_MS = 8_000;

// Wohin es nach dem Lauf zurückgeht. Feste Liste statt Pfad aus der URL —
// sonst ließe sich die Weiterleitung auf eine fremde Seite umbiegen.
//
// Map und nicht ein Objektliteral: bei einem Literal liefern die Schlüssel
// "__proto__" und "constructor" geerbte Werte vom Object-Prototyp statt
// undefined, der Rückfall auf /liga greift dann nicht.
const ZIELE = new Map([
  ["liga", "/liga"],
  ["markt", "/liga/markt"],
]);

export async function POST(request) {
  const { token, nutzer } = await sitzung();
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");

  const abgelehnt = await pruefeApi(request, leagueId, token);
  if (abgelehnt) return abgelehnt;

  const zurueck = searchParams.get("zurueck") === "1";
  const ziel = ZIELE.get(searchParams.get("ziel")) ?? "/liga";
  const ende = Date.now() + GESAMTBUDGET_MS;
  const rest = () => ende - Date.now();

  const erledigt = [];
  const offen = [];

  try {
    await initSchema();
    const settings = await getSettings(leagueId, nutzer);
    const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
    const ids = (ranking.us ?? []).filter((m) => m.adm !== true).map((m) => m.i);

    // 1. Feed – die Geldbewegungen. Alles andere ist Beiwerk.
    const status = await getImportStatus(leagueId);
    const erstlauf = !status.komplett;
    const imp = await importiere(leagueId, token, {
      vollstaendig: erstlauf,
      startAb: erstlauf ? status.offsetPos : 0,
      zeitbudgetMs: Math.max(MINDESTZEIT_MS, rest() - 20_000),
    });
    await logImport(leagueId, imp.neu, imp.gesamt, imp.naechsterStart, erstlauf ? imp.fertig : true);
    erledigt.push(`${imp.neu} neue Events`);
    if (imp.gestoppt) offen.push("Feed");

    // 2. Transfermarkt mitschreiben – ein Angebot ist nach einem Tag weg,
    //    und daraus ergibt sich der Rhythmus, nach dem Spieler wiederkommen.
    //    Ein einzelner Abruf, deshalb ohne eigene Zeitprüfung.
    try {
      const mk = await speichereMarkt(leagueId, token);
      if (mk.neu > 0) erledigt.push(`${mk.neu} neue Marktangebote`);
    } catch {
      // Der Markt ist Beiwerk – der Rest des Laufs soll daran nicht scheitern
    }

    // 3. Teamwerte – ohne sie stimmen Max-Gebot und Gesamtwert nicht
    if (rest() > MINDESTZEIT_MS) {
      const tw = await ladeTeamwerte(leagueId, ids, token, { frist: ende - 12_000 });
      erledigt.push(`Teamwerte ${tw.geladen}/${tw.gesamt}`);
      if (tw.gestoppt) offen.push("Teamwerte");
    } else {
      offen.push("Teamwerte");
    }

    // 4. Marktwert-Historien für Käufe, deren Bezugsgröße noch fehlt.
    //    Ohne sie fallen genau die Käufe aus der Aufschlags-Rechnung, deren
    //    Angebot nicht mehr im Feed steht — ein Manager mit 11 Spielern
    //    erschien dann mit 7 Käufen.
    if (rest() > MINDESTZEIT_MS) {
      const mw = await ergaenzeMarktwerte(leagueId, token, {
        frist: ende - 8_000,
        stichtag: settings.stichtag,
      });
      if (mw.geholt > 0 || mw.ohneHistorie > 0) {
        erledigt.push(`Marktwerte ${mw.geholt}/${mw.offen}`);
      }
      if (mw.gestoppt) offen.push("Marktwerte");
    }

    // 5. Kader – Grundlage für Markt und Verkaufsrechner
    if (rest() > MINDESTZEIT_MS) {
      const kd = await ladeKader(leagueId, ids, token, { frist: ende - 4_000 });
      erledigt.push(`Kader ${kd.geladen}/${kd.gesamt}`);
      if (kd.gestoppt) offen.push("Kader");
    } else {
      offen.push("Kader");
    }

    // 6. Historie – nur solange die Lücke nicht abgearbeitet ist
    const log = await sql`SELECT * FROM rekon_log WHERE league_id = ${leagueId}`;
    const rekonFertig = log[0]?.fertig ?? false;
    if (!rekonFertig && rest() > MINDESTZEIT_MS) {
      const rk = await rekonstruiere(leagueId, token, settings.stichtag, {
        abIndex: log[0]?.position ?? 0,
        zeitbudgetMs: Math.max(2_000, rest() - 2_000),
      });
      const gefunden = (log[0]?.gefunden ?? 0) + rk.neu;
      await sql`
        INSERT INTO rekon_log (league_id, position, fertig, letzter, gefunden)
        VALUES (${leagueId}, ${rk.index}, ${rk.fertig}, NOW(), ${gefunden})
        ON CONFLICT (league_id) DO UPDATE
          SET position = ${rk.index}, fertig = ${rk.fertig}, letzter = NOW(), gefunden = ${gefunden}`;
      erledigt.push(`Historie ${rk.index}/${rk.gesamt}`);
      if (!rk.fertig) offen.push("Historie");
    } else if (!rekonFertig) {
      offen.push("Historie");
    }

    const text = erledigt.join(" · ") +
      (offen.length ? ` — offen: ${offen.join(", ")}, nochmal klicken` : "");

    if (zurueck) {
      return Response.redirect(
        new URL(`${ziel}?${new URLSearchParams({ league: leagueId, tw: text })}`, request.url), 303);
    }
    return Response.json({ erledigt, offen });
  } catch (e) {
    if (zurueck) {
      return Response.redirect(
        new URL(`${ziel}?league=${leagueId}&fehler=${encodeURIComponent(e.message)}`, request.url), 303);
    }
    return Response.json({ error: e.message }, { status: 500 });
  }
}
