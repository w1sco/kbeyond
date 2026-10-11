import { sql } from "./db";
import { kbFetch } from "./kickbase";

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Läuft über die gemeinsame Bremse in kickbase.js – Abstand, Wiederholung
// und Abbruch bei Drosselung gelten damit auch für den Feed-Import.
function holeSeite(leagueId, token, start, max) {
  return kbFetch(`/v4/leagues/${leagueId}/activitiesFeed?start=${start}&max=${max}`, token);
}

function parseEvent(leagueId, e) {
  const d = e.data ?? {};
  return {
    id: String(e.i),
    league_id: leagueId,
    type: e.t,
    dt: e.dt,
    buyer: d.byr ?? null,
    seller: d.slr ?? null,
    price: d.trp ?? null,
    player_id: d.pi ? String(d.pi) : null,
    player_name: d.pn ?? ([d.fn, d.ln].filter(Boolean).join(" ") || null),
    raw: JSON.stringify(d),
  };
}

async function speichereBlock(events) {
  if (events.length === 0) return;

  await sql`
    INSERT INTO events (id, league_id, type, dt, buyer, seller, price, player_id, player_name, raw)
    SELECT * FROM UNNEST(
      ${events.map((e) => e.id)}::text[],
      ${events.map((e) => e.league_id)}::text[],
      ${events.map((e) => e.type)}::int[],
      ${events.map((e) => e.dt)}::timestamptz[],
      ${events.map((e) => e.buyer)}::text[],
      ${events.map((e) => e.seller)}::text[],
      ${events.map((e) => e.price)}::bigint[],
      ${events.map((e) => e.player_id)}::text[],
      ${events.map((e) => e.player_name)}::text[],
      ${events.map((e) => e.raw)}::jsonb[]
    )
    ON CONFLICT (id) DO NOTHING`;
}

// Der Feed wird von vorne gelesen, das Neueste zuerst. Bis wohin?
//
// **Bis zum lückenlosen Bestand, nicht bis zur ersten bekannten Seite.**
// Früher hörte ein Lauf auf, sobald eine Seite nur Bekanntes trug. Brach
// ein Lauf nach einer Pause mittendrin ab (Drosselung, Zeitbudget), standen
// die neuesten Seiten schon in der Datenbank — und der nächste Lauf traf
// sofort auf „bekannt“ und hörte auf. Der ältere Teil der Pause kam nie
// mehr herein, und niemand merkte es.
//
// `lueckenlosBis` ist der jüngste Zeitpunkt, bis zu dem der Feed ohne Loch
// in der Datenbank steht. Ein Lauf liest, bis er ein Event erreicht, das
// nicht jünger ist — erst dort schließt er an. Fertig wird die Marke auf
// das Neueste dieses Laufs gesetzt; ein abgebrochener Lauf lässt sie stehen,
// und der nächste fängt oben neu an (was er schon hat, kostet nur Abrufe).
//
// **Endet der Feed, bevor er anschließt, ist das eine Lücke.** Kickbase
// liefert nur die letzten ~670 Einträge; wer lange genug nicht
// aktualisiert, verliert, was dazwischen lag. Das wird zurückgegeben
// (`luecke`), damit der Lauf es festhält und die Transfers über die
// Spielerhistorie nachholt. Strafen aus dieser Zeit sind verloren.
export async function importiere(leagueId, token, opt = {}) {
  const {
    proSeite = 100,
    vollstaendig = false,
    startAb = 0,
    zeitbudgetMs = 45000,
    lueckenlosBis = null,
  } = opt;

  const beginn = Date.now();

  const bekannt = new Set(
    (await sql`SELECT id FROM events WHERE league_id = ${leagueId}`).map((r) => r.id)
  );
  // Ohne gemerkte Marke gilt der bisherige Bestand als lückenlos — so hat
  // der Importer bisher gearbeitet, und anders wissen wir es nicht.
  let marke = lueckenlosBis ? new Date(lueckenlosBis) : null;
  if (!marke && !vollstaendig) {
    const r = await sql`
      SELECT MAX(dt) AS dt FROM events WHERE league_id = ${leagueId} AND id NOT LIKE 'rk%'`;
    marke = r[0]?.dt ? new Date(r[0].dt) : null;
  }

  let start = startAb;
  let neu = 0;
  let seiten = 0;
  let fertig = false;
  let gestoppt = null;
  let neuestes = null;
  let aeltestes = null;
  let luecke = null;

  while (true) {
    if (Date.now() - beginn > zeitbudgetMs) {
      gestoppt = "Zeitbudget erreicht – nochmal klicken zum Fortsetzen";
      break;
    }

    const daten = await holeSeite(leagueId, token, start, proSeite);
    const liste = daten.af ?? [];
    seiten++;

    if (liste.length === 0) {
      fertig = true;
      // Ans Ende gekommen, ohne anzuschließen: Zwischen der Marke und dem
      // ältesten Event dieses Laufs fehlt etwas.
      if (!vollstaendig && marke && aeltestes && aeltestes > marke) {
        luecke = { von: marke.toISOString(), bis: aeltestes.toISOString() };
      }
      break;
    }

    const geparst = liste.map((e) => parseEvent(leagueId, e));
    for (const e of geparst) {
      const d = e.dt ? new Date(e.dt) : null;
      if (!d || isNaN(d)) continue;
      if (!neuestes || d > neuestes) neuestes = d;
      if (!aeltestes || d < aeltestes) aeltestes = d;
    }

    const frisch = geparst.filter((e) => !bekannt.has(e.id));
    await speichereBlock(frisch);
    for (const e of frisch) bekannt.add(e.id);
    neu += frisch.length;

    // Angeschlossen: Diese Seite reicht in den lückenlosen Bestand.
    const schliesstAn = marke
      ? geparst.some((e) => e.dt && new Date(e.dt) <= marke)
      : false;
    if (!vollstaendig && (schliesstAn || (!marke && frisch.length === 0))) {
      gestoppt = "bekannte Events erreicht";
      fertig = true;
      break;
    }

    start += liste.length;
    await schlaf(250);
  }

  const gesamt = (
    await sql`SELECT COUNT(*)::int AS n FROM events WHERE league_id = ${leagueId}`
  )[0].n;

  // Die neue Marke: nur, wenn der Lauf fertig ist. Mit einer Lücke trotzdem
  // — die ist festgehalten, und ab hier ist der Bestand wieder lückenlos.
  // Der Erstimport liest in Häppchen ab einer Position; sein Neuestes ist
  // dann nicht das der Liga. Fertig steht dort alles da, was es gibt.
  let neueMarke = marke;
  if (fertig && vollstaendig) {
    const r = await sql`
      SELECT MAX(dt) AS dt FROM events WHERE league_id = ${leagueId} AND id NOT LIKE 'rk%'`;
    neueMarke = r[0]?.dt ? new Date(r[0].dt) : null;
  } else if (fertig) {
    neueMarke = [neuestes, marke].filter(Boolean).sort((a, b) => b - a)[0] ?? null;
  }

  return {
    neu, seiten, gesamt, fertig, gestoppt, naechsterStart: fertig ? 0 : start,
    lueckenlosBis: neueMarke ? neueMarke.toISOString() : null,
    luecke,
  };
}
