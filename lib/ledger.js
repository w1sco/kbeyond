import { sql } from "./db";

export function loginBonus(tage) {
  if (tage <= 0) return 0;
  if (tage < 10) return (tage * (tage + 1)) / 2 * 10_000;
  return 450_000 + (tage - 9) * 100_000;
}

export async function berechneKonten(leagueId, manager, settings) {
  const stichtag = settings.stichtag ?? new Date(0);

  const events = await sql`
    SELECT buyer, seller, price, dt FROM events
    WHERE league_id = ${leagueId} AND type = 15 AND dt >= ${stichtag}`;

  const konten = new Map();
  const init = (name) => {
    if (!konten.has(name)) konten.set(name, { name, kaeufe: 0, verkaeufe: 0, anzKauf: 0, anzVerkauf: 0 });
    return konten.get(name);
  };

  for (const e of events) {
    const preis = Number(e.price ?? 0);
    if (e.buyer) { const k = init(e.buyer); k.kaeufe += preis; k.anzKauf++; }
    if (e.seller) { const k = init(e.seller); k.verkaeufe += preis; k.anzVerkauf++; }
  }

  const tage = settings.login_start
    ? Math.floor((Date.now() - new Date(settings.login_start)) / 86_400_000) + 1
    : Math.floor((Date.now() - new Date(stichtag)) / 86_400_000) + 1;

  const bonus = settings.login_aktiv ? loginBonus(tage) : 0;
  const start = Number(settings.startbudget);
  const proPunkt = Number(settings.punkte_bonus);

  const korrekturen = new Map(
    (await sql`SELECT manager, betrag FROM korrektur WHERE league_id = ${leagueId}`)
      .map((r) => [r.manager, Number(r.betrag)])
  );

  const namensZaehler = new Map();
  for (const m of manager) namensZaehler.set(m.n, (namensZaehler.get(m.n) ?? 0) + 1);

  return manager.map((m) => {
    const k = konten.get(m.n) ?? { kaeufe: 0, verkaeufe: 0, anzKauf: 0, anzVerkauf: 0 };
    const punkteBonus = Number(m.sp ?? 0) * proPunkt;
    const korrektur = korrekturen.get(m.n) ?? 0;
    return {
      id: m.i,
      name: m.n,
      punkte: Number(m.sp ?? 0),
      teamwert: Number(m.tv ?? 0),
      platz: m.spl,
      beigetreten: m.jd,
      kaeufe: k.kaeufe,
      verkaeufe: k.verkaeufe,
      anzKauf: k.anzKauf,
      anzVerkauf: k.anzVerkauf,
      loginBonus: bonus,
      punkteBonus,
      konto: start + bonus + punkteBonus + k.verkaeufe - k.kaeufe + korrektur,
      mehrdeutig: namensZaehler.get(m.n) > 1,
      tageGezaehlt: tage,
    };
  });
}
