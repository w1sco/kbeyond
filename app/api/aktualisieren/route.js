import { initSchema, getSettings, logImport, getImportStatus, werBrauchtNeueDaten, mitternachtDeutsch, sql, merkeTagesstand, getTeamwerte, getAktiveManager } from "@/lib/db";
import { kbFetch } from "@/lib/kickbase";
import { importiere } from "@/lib/importer";
import { berechneKonten } from "@/lib/ledger";
import { ladeTeamwerte } from "@/lib/teamwerte";
import { ladeKader, ladeAufstellungen } from "@/lib/kader";
import { rekonstruiere, holePool, aktualisierePool } from "@/lib/rekonstruktion";
import { speichereMarkt } from "@/lib/marktbeobachtung";
import { ergaenzeMarktwerte } from "@/lib/marktwerte";
import { pruefeApi, sitzung } from "@/lib/auth";
import { bremseZuruecksetzen } from "@/lib/kickbase";
import { nurMitspieler } from "@/lib/manager";

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

  const zurueck = searchParams.get("zurueck") === "1";
  const ziel = ZIELE.get(searchParams.get("ziel")) ?? "/liga";

  const abgelehnt = await pruefeApi(request, leagueId, token, zurueck ? ziel : null);
  if (abgelehnt) return abgelehnt;
  const ende = Date.now() + GESAMTBUDGET_MS;
  const rest = () => ende - Date.now();

  const erledigt = [];
  const offen = [];

  const voll = searchParams.get("voll") === "1";

  try {
    bremseZuruecksetzen();
    await initSchema();
    const settings = await getSettings(leagueId, nutzer);
    const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
    // Der Liga-Admin ist nicht automatisch ein Manager: In manchen Ligen
    // verwaltet er nur, in anderen spielt er mit. Ausgeblendet wird er
    // deshalb nur, wenn er wirklich keine Mannschaft hat — sonst fragt der
    // Lauf einen Kader ab, den es nicht gibt.
    const mitKader = new Set(
      (await sql`SELECT DISTINCT manager_id FROM kader WHERE league_id = ${leagueId}`)
        .map((z) => String(z.manager_id))
    );
    const gehandelt = await getAktiveManager(leagueId);
    const mitspieler = nurMitspieler(ranking.us, { ids: mitKader, namen: gehandelt });
    const ids = mitspieler.map((m) => m.i);

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
    // gestoppt setzt der Importer auch, wenn er normal fertig ist ("bekannte
    // Events erreicht"). Offen ist der Feed nur, wenn er NICHT fertig wurde.
    if (imp.gestoppt && !imp.fertig) offen.push("Feed");

    // 2. Transfermarkt mitschreiben – ein Angebot ist nach einem Tag weg,
    //    und daraus ergibt sich der Rhythmus, nach dem Spieler wiederkommen.
    //    Ein einzelner Abruf, deshalb ohne eigene Zeitprüfung.
    try {
      const mk = await speichereMarkt(leagueId, token);
      if (mk.neu > 0) erledigt.push(`${mk.neu} neue Marktangebote`);
    } catch {
      // Der Markt ist Beiwerk – der Rest des Laufs soll daran nicht scheitern
    }

    // 3. Spielerpool – Neuzugänge, Vereinswechsel, neue Marktwerte.
    //
    //    Einmal am Tag, nach derselben Regel wie Teamwerte und Kader: Ist
    //    der Stand von vor der letzten Mitternacht, wird nachgesehen.
    //
    //    Das lief früher beim Seitenaufruf der Marktseite los — 19 Anfragen
    //    mitten im Rendern, an der Bremse vorbei. Jetzt hier, im Lauf, den
    //    der Nutzer bewusst auslöst.
    const pool = await holePool();
    const poolAlt =
      pool.leer || !pool.stand || new Date(pool.stand) < mitternachtDeutsch();

    if (!poolAlt && !voll) {
      erledigt.push("Spielerliste aktuell");
    } else if (rest() > MINDESTZEIT_MS) {
      try {
        const pl = await aktualisierePool(token, { frist: ende - 25_000 });
        if (pl.neu > 0) {
          // Neuzugänge namentlich – daran sieht man, dass es funktioniert
          const namen = pl.zugaenge.join(", ");
          erledigt.push(
            `${pl.neu} neue Spieler` + (namen ? ` (${namen}${pl.neu > pl.zugaenge.length ? " …" : ""})` : "")
          );
        }
        if (pl.geaendert > 0) erledigt.push(`${pl.geaendert} Spieler geändert`);
        if (pl.neu === 0 && pl.geaendert === 0 && pl.vollstaendig) {
          erledigt.push("Spielerliste unverändert");
        }
        if (!pl.vollstaendig) offen.push(`Spielerliste (${pl.vereine}/${pl.gesamt} Vereine)`);
      } catch (e) {
        if (e.gedrosselt) throw e;
        offen.push("Spielerliste");
      }
    } else {
      offen.push("Spielerliste");
    }

    // 4. Teamwerte – ohne sie stimmen Max-Gebot und Gesamtwert nicht
    // Wer braucht überhaupt neue Daten? Der Feed weiß es: ein Kader ändert
    // sich nur durch Transfers, ein Teamwert zusätzlich durch die tägliche
    // Marktwertanpassung. Nichts wird doppelt geholt, und es fehlt nie etwas.
    const noetig = voll
      ? { teamwerte: ids, kader: ids }
      : await werBrauchtNeueDaten(leagueId, mitspieler);

    if (noetig.teamwerte.length === 0) {
      erledigt.push("Teamwerte aktuell");
    } else if (rest() > MINDESTZEIT_MS) {
      const tw = await ladeTeamwerte(leagueId, noetig.teamwerte, token, { frist: ende - 12_000 });
      erledigt.push(`Teamwerte ${tw.geladen}/${tw.gesamt}`);
      if (tw.gestoppt) offen.push("Teamwerte");
    } else {
      offen.push("Teamwerte");
    }

    // 5. Marktwert-Historien für Käufe, deren Bezugsgröße noch fehlt.
    //    Ohne sie fallen genau die Käufe aus der Aufschlags-Rechnung, deren
    //    Angebot nicht mehr im Feed steht — ein Manager mit 11 Spielern
    //    erschien dann mit 7 Käufen.
    if (rest() > MINDESTZEIT_MS) {
      const mw = await ergaenzeMarktwerte(leagueId, token, {
        frist: ende - 8_000,
        stichtag: settings.stichtag,
      });
      if (mw.ohnePfad) {
        erledigt.push(
          mw.erschoepft
            ? "Marktwert-Historie: kein Endpunkt gefunden, Suche beendet"
            : `Marktwert-Historie: ${mw.geprobt} Kandidaten geprüft, ${mw.restlich} offen`
        );
      } else if (mw.geholt > 0) {
        erledigt.push(`Marktwerte ${mw.geholt}/${mw.offen}`);
      }
      if (mw.gedrosselt) offen.push("Marktwerte (gedrosselt)");
      else if (mw.gestoppt) offen.push("Marktwerte");
    }

    // 6. Kader – Grundlage für Markt und Verkaufsrechner
    if (noetig.kader.length === 0) {
      erledigt.push("Kader aktuell");
    } else if (rest() > MINDESTZEIT_MS) {
      const kd = await ladeKader(leagueId, noetig.kader, token, { frist: ende - 4_000 });
      // Sagen, WARUM etwas fehlt – "1/2" allein lässt einen raten
      const gruende = [];
      if (kd.leer > 0) {
        // Namen statt Zahl: "1 ohne auswertbare Liste" sagt nicht, wo man
        // nachsehen soll.
        const namen = (kd.leereManager ?? [])
          .map((uid) => (ranking.us ?? []).find((m) => String(m.i) === uid)?.n ?? `#${uid}`)
          .slice(0, 3);
        gruende.push(
          `ohne auswertbare Liste: ${namen.join(", ")}` +
            (kd.leer > namen.length ? ` und ${kd.leer - namen.length} weitere` : "")
        );
      }
      if (kd.fehler > 0) gruende.push(`${kd.fehler} mit Abruffehler`);
      if (kd.ohneNamen > 0) gruende.push(`${kd.ohneNamen} Spieler ohne Namen`);
      erledigt.push(
        `Kader ${kd.geladen}/${kd.gesamt}` + (gruende.length ? ` (${gruende.join(", ")})` : "")
      );

    } else {
      offen.push("Kader");
    }

    // 7. Die echte Aufstellung.
    //
    // Eigener Schritt, nicht am Kader hängend: Eine Aufstellung ändert
    // sich, wenn der Manager sie ändert — unabhängig von Transfers und
    // Marktwertanpassung. Vorher hing sie im Kader-Zweig und wurde
    // deshalb übersprungen, sobald die Kader schon aktuell waren. Genau
    // dann stand überall "keine Aufstellung erkennbar".
    if (rest() > 3_000) {
      let auf = { manager: 0, spieler: 0, pfad: null };
      try {
        auf = await ladeAufstellungen(leagueId, token, ids, { frist: ende - 3_000 });
      } catch (e) {
        if (e.gedrosselt) throw e;
      }

      if (auf.manager > 0) {
        erledigt.push(
          `Aufstellung ${auf.manager} Manager` +
            (auf.art ? ` über ${auf.art}` : "") +
            (auf.eigenstaendig ? "" : " — Kickbase gibt fremde Aufstellungen nicht heraus")
        );
      } else {
        erledigt.push("Aufstellung nicht abrufbar — siehe /aufstellung");
      }
    } else {
      offen.push("Aufstellung");
    }

    // Tagesstand festhalten: Teamwert, Kontostand und Punkte je Manager.
    // Daraus entstehen die Platzierungspfeile auf der Ligaseite. Kostet
    // keinen einzigen Kickbase-Aufruf – alles steht schon in der Datenbank.
    try {
      const konten = await berechneKonten(leagueId, mitspieler, settings);
      const tw2 = await getTeamwerte(leagueId);
      const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
      await merkeTagesstand(
        leagueId,
        konten.map((k) => ({ ...k, teamwert: tw2.map.get(String(k.id))?.teamwert ?? 0 })),
        heute
      );
    } catch {
      // Der Tagesstand ist Beiwerk – der Lauf soll daran nicht scheitern
    }

    // 7. Historie – nur solange die Lücke nicht abgearbeitet ist
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
    // Drosselung ist kein Fehler im Code, sondern ein Hinweis zu warten.
    const text = e.gedrosselt
      ? "Kickbase drosselt gerade. Bitte ein paar Minuten warten — der Lauf macht danach dort weiter, wo er stand."
      : e.message;
    if (zurueck) {
      return Response.redirect(
        new URL(`${ziel}?league=${leagueId}&fehler=${encodeURIComponent(text)}`, request.url), 303);
    }
    return Response.json({ error: text }, { status: e.gedrosselt ? 503 : 500 });
  }
}
