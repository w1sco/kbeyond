import { sql } from "./db";

export function loginBonus(tage) {
  if (tage <= 0) return 0;
  if (tage < 10) return (tage * (tage + 1)) / 2 * 10_000;
  return 450_000 + (tage - 9) * 100_000;
}

export async function berechneKonten(leagueId, manager, settings, meinName) {
  const stichtag = settings.stichtag ?? new Date(0);

  const events = await sql`
    SELECT buyer, seller, price FROM events
    WHERE league_id = ${leagueId} AND type = 15 AND dt >= ${stichtag}`;

  const konten = new Map();
  const init = (name) => {
    if (!konten.has(name)) {
      konten.set(name, { kaeufe: 0, verkaeufe: 0, anzKauf: 0, anzVerkauf: 0, strafen: 0, anzStrafen: 0 });
    }
    return konten.get(name);
  };

  for (const e of events) {
    const preis = Number(e.price ?? 0);
    if (e.buyer) { const k = init(e.buyer); k.kaeufe += preis; k.anzKauf++; }
    if (e.seller) { const k = init(e.seller); k.verkaeufe += preis; k.anzVerkauf++; }
  }

  // Strafen (t=29): Betrag in amt, Manager in n. amt ist bereits negativ.
  const strafen = await sql`
    SELECT raw->>'n' AS manager, (raw->>'amt')::bigint AS betrag
    FROM events
    WHERE league_id = ${leagueId} AND type = 29
      AND dt >= ${stichtag} AND raw ? 'amt' AND raw ? 'n'`;

  for (const s of strafen) {
    if (!s.manager) continue;
    const k = init(s.manager);
    k.strafen += Number(s.betrag);
    k.anzStrafen++;
  }

  const bz = await sql`
    SELECT COALESCE(SUM((raw->>'bn')::bigint), 0)::bigint AS summe,
           COUNT(*)::int AS anzahl,
           MAX((raw->>'day')::int) AS max_tag
    FROM events
    WHERE league_id = ${leagueId} AND type = 22
      AND dt >= ${stichtag} AND raw ? 'bn'`;

  const bonusEcht = Number(bz[0]?.summe ?? 0);
  const bonusTage = bz[0]?.anzahl ?? 0;
  const maxTag = bz[0]?.max_tag ?? null;

  const referenz = settings.login_start ? new Date(settings.login_start) : new Date(stichtag);
  const quelle = settings.login_start ? "manuell gesetzt" : "Stichtag";
  const tage = Math.max(0, Math.floor((Date.now() - referenz) / 86_400_000));
  const bonus = settings.login_aktiv ? loginBonus(tage) : 0;

  const startbudget = Number(settings.startbudget);
  const proPunkt = Number(settings.punkte_bonus);

  const korrekturen = new Map(
    (await sql`SELECT manager, betrag FROM korrektur WHERE league_id = ${leagueId}`)
      .map((r) => [r.manager, Number(r.betrag)])
  );

  const namensZaehler = new Map();
  for (const m of manager) namensZaehler.set(m.n, (namensZaehler.get(m.n) ?? 0) + 1);

  return manager.map((m) => {
    const k = konten.get(m.n) ?? { kaeufe: 0, verkaeufe: 0, anzKauf: 0, anzVerkauf: 0, strafen: 0, anzStrafen: 0 };
    const punkteBonus = Number(m.sp ?? 0) * proPunkt;
    const korrektur = korrekturen.get(m.n) ?? 0;

    return {
      id: m.i,
      name: m.n,
      punkte: Number(m.sp ?? 0),
      teamwert: Number(m.tv ?? 0),
      platz: m.spl,
      kaeufe: k.kaeufe,
      verkaeufe: k.verkaeufe,
      anzKauf: k.anzKauf,
      anzVerkauf: k.anzVerkauf,
      strafen: k.strafen,
      anzStrafen: k.anzStrafen,
      loginBonus: bonus,
      bonusIstEcht: false,
      punkteBonus,
      korrektur,
      konto: startbudget + bonus + punkteBonus + k.verkaeufe - k.kaeufe + k.strafen + korrektur,
      mehrdeutig: namensZaehler.get(m.n) > 1,
      bonusEcht,
      bonusFormel: bonus,
      bonusTage,
      maxTag,
      tageGezaehlt: tage,
      bonusQuelle: quelle,
    };
  });
}
