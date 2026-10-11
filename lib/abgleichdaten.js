import { sql } from "./db.js";
import { berechneKonten } from "./ledger.js";
import { erklaereDifferenz, doppelteVerdacht } from "./abgleich.js";

// Der Abgleich eines Managers mit einem echten Kontostand — die Daten dazu.
//
// Gerechnet wird **zu dem Zeitpunkt, an dem der echte Wert abgelesen
// wurde**, nicht jetzt: Ein Kauf nach dem Screenshot gehört nicht in die
// Rechnung, sonst stünde sein Preis als Differenz da. Was danach kam, wird
// eigens genannt.
//
// Die Rechnung steht hier und nicht in der Seite, weil „Differenz als
// Korrektur übernehmen“ dieselbe Zahl braucht — und die darf nicht aus dem
// Formular kommen.

export async function ladeKontrollwert(leagueId, nutzer, managerId) {
  const r = await sql`
    SELECT betrag, zeitpunkt, eingetragen FROM kontrollwert
    WHERE league_id = ${leagueId} AND user_id = ${nutzer ?? ""} AND manager_id = ${String(managerId)}`;
  return r[0] ?? null;
}

export async function abgleich({ leagueId, settings, alle, manager, nutzer }) {
  const kw = await ladeKontrollwert(leagueId, nutzer, manager.i);
  if (!kw) return null;
  const zeitpunkt = new Date(kw.zeitpunkt);

  // Punkte zum Zeitpunkt: Hat seither niemand gespielt, sind es die von
  // jetzt. Sonst stimmt der Punkte-Bonus womöglich nicht — das steht dann da.
  const [spaeter] = await sql`
    SELECT COUNT(*)::int AS n FROM spiele WHERE datum > ${zeitpunkt} AND datum <= NOW()`;
  const punkteUnsicher = (spaeter?.n ?? 0) > 0;

  const konten = await berechneKonten(leagueId, alle, settings, { bis: zeitpunkt });
  const k = konten.find((x) => String(x.id) === String(manager.i));
  if (!k) return null;

  const echt = Number(kw.betrag);
  const diff = echt - k.konto;

  const zeilen = await sql`
    SELECT dt, buyer, seller, price, player_name, id FROM events
    WHERE league_id = ${leagueId} AND type = 15 AND dt >= ${settings.stichtag}
      AND (buyer = ${manager.n} OR seller = ${manager.n})
    ORDER BY dt ASC`;
  const alleTransfers = zeilen.map((z) => ({
    dt: new Date(z.dt).toISOString(),
    kauf: z.buyer === manager.n,
    preis: Number(z.price ?? 0),
    spieler: z.player_name ?? "?",
    quelle: String(z.id).startsWith("rk") ? "rk" : "feed",
  }));
  const bis = alleTransfers.filter((t) => new Date(t.dt) <= zeitpunkt);
  const danach = alleTransfers.filter((t) => new Date(t.dt) > zeitpunkt);

  const tage = settings.login_aktiv ? k.tageGezaehlt : 0;
  return {
    echt,
    zeitpunkt,
    berechnet: k.konto,
    diff,
    posten: {
      loginBonus: k.loginBonus, punkteBonus: k.punkteBonus, punkte: k.punkte,
      kaeufe: k.kaeufe, verkaeufe: k.verkaeufe, strafen: k.strafen, korrektur: k.korrektur,
    },
    tage,
    // Tag d der Staffel ist die d-te Mitternacht nach dem Startpunkt.
    loginStart: settings.login_start ?? settings.stichtag,
    erklaerungen: erklaereDifferenz({
      diff, tage, transfers: bis, proPunkt: Number(settings.punkte_bonus ?? 0) }),
    doppelt: doppelteVerdacht(bis),
    danach,
    punkteUnsicher,
    mehrdeutig: k.mehrdeutig === true,
  };
}
