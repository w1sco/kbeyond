// Den Verlauf bis zum Liga-Reset zurück rekonstruieren.
//
// `tagesstand` wird erst seit kurzem geschrieben — der Verlauf begann
// deshalb an dem Tag, an dem jemand zum ersten Mal aktualisiert hat. Alles
// davor lässt sich aber **ausrechnen**: Die Events tragen jeden Kauf und
// Verkauf mit Preis und Datum, und daraus folgen sowohl der Kontostand als
// auch der Kader an jedem einzelnen Tag.
//
// **Das kostet keinen einzigen Kickbase-Aufruf.** Alles steht schon in der
// Datenbank.

import { sql } from "./db";
import { loginBonus } from "./loginbonus";
import { fuerTag, tageSeit } from "./format";
import { tageZwischen, wertAmTag, punkteAmTag } from "./verlauf";

// Der eigentliche Lauf. Gibt je Tag und Manager Kontostand, Kaderwert und
// die Zahl der Spieler zurück, deren Marktwert an dem Tag bekannt war.
export async function rekonstruiereVerlauf(leagueId, manager, settings) {
  const stichtag = settings?.stichtag;
  if (!stichtag) return { tage: [], staende: new Map(), grund: "kein Stichtag gesetzt" };

  const tage = tageZwischen(stichtag, new Date());
  if (tage.length === 0) return { tage: [], staende: new Map(), grund: "Stichtag liegt in der Zukunft" };

  const [events, mwZeilen, korrekturen, gemesseneZeilen, anpfiffZeilen] = await Promise.all([
    sql`
      SELECT type, dt, buyer, seller, price, player_id, raw
      FROM events
      WHERE league_id = ${leagueId} AND dt >= ${stichtag}
      ORDER BY dt ASC`,
    sql`
      SELECT player_id, tag, marktwert FROM marktwert_verlauf
      UNION ALL
      SELECT player_id, tag, marktwert FROM mw_beobachtung
      ORDER BY tag ASC`,
    // Nur die Korrekturen dessen, mit dessen Einstellungen gerechnet wird —
    // wie im Ledger. Die Summe über alle Nutzer zählte eine Korrektur
    // doppelt, sobald zwei Leute denselben Manager korrigiert hatten.
    sql`SELECT manager, betrag FROM korrektur
        WHERE league_id = ${leagueId} AND user_id = ${settings.user_id ?? ""}`,
    // Gemessene Punkte je Manager und Tag — Grundlage für punkteAmTag().
    sql`SELECT manager_id, tag, punkte FROM tagesstand
        WHERE league_id = ${leagueId} AND rekonstruiert IS NOT TRUE AND punkte IS NOT NULL
        ORDER BY tag ASC`,
    // Wann angepfiffen wurde: Nur dann können sich Punkte bewegen.
    sql`SELECT DISTINCT datum FROM spiele WHERE datum IS NOT NULL AND datum <= NOW()`,
  ]);

  const gemessen = new Map();
  for (const z of gemesseneZeilen) {
    const id = String(z.manager_id);
    if (!gemessen.has(id)) gemessen.set(id, []);
    gemessen.get(id).push([fuerTag(z.tag), Number(z.punkte)]);
  }
  const anpfiffe = [...new Set(anpfiffZeilen.map((z) => fuerTag(z.datum)))].sort();
  const proPunkt = Number(settings.punkte_bonus ?? 0);

  // Marktwerte je Spieler, aufsteigend nach Tag.
  const mw = new Map();
  for (const z of mwZeilen) {
    const id = String(z.player_id);
    if (!mw.has(id)) mw.set(id, []);
    mw.get(id).push([fuerTag(z.tag), Number(z.marktwert ?? 0)]);
  }

  // Zuordnung Name → Manager. Bei doppelten Namen ist das Feld kein Beleg,
  // sondern eine Verwechslung — dieselbe Regel wie im Ledger.
  const zaehler = new Map();
  for (const m of manager) zaehler.set(m.n, (zaehler.get(m.n) ?? 0) + 1);
  const nachName = new Map();
  for (const m of manager) if (zaehler.get(m.n) === 1) nachName.set(m.n, String(m.i));

  const startbudget = Number(settings.startbudget ?? 0);
  const korrektur = new Map(
    korrekturen.map((k) => [k.manager, Number(k.betrag ?? 0)])
  );
  const referenz = settings.login_start ? new Date(settings.login_start) : new Date(stichtag);

  // Laufender Zustand je Manager.
  const zustand = new Map();
  const hole = (id) => {
    if (!zustand.has(id)) zustand.set(id, { saldo: 0, kader: new Set() });
    return zustand.get(id);
  };
  for (const m of manager) hole(String(m.i));

  let i = 0;
  const staende = new Map();

  for (const tag of tage) {
    // Alle Events, die an diesem Tag oder davor passiert sind.
    while (i < events.length && fuerTag(events[i].dt) <= tag) {
      const e = events[i++];
      const preis = Number(e.price ?? 0);
      const pid = e.player_id == null ? null : String(e.player_id);

      if (e.buyer && nachName.has(e.buyer)) {
        const z = hole(nachName.get(e.buyer));
        z.saldo -= preis;
        if (pid) z.kader.add(pid);
      }
      if (e.seller && nachName.has(e.seller)) {
        const z = hole(nachName.get(e.seller));
        z.saldo += preis;
        if (pid) z.kader.delete(pid);
      }
      // Strafen: `amt` ist bereits negativ.
      if (Number(e.type) === 29 && e.raw?.n && nachName.has(e.raw.n)) {
        hole(nachName.get(e.raw.n)).saldo += Number(e.raw.amt ?? 0);
      }
    }

    // Login-Bonus bis zu diesem Tag – gezählt werden Mitternachte.
    const bonus = settings.login_aktiv
      ? loginBonus(tageSeit(referenz, `${tag}T12:00:00Z`))
      : 0;

    const proTag = new Map();
    for (const m of manager) {
      const id = String(m.i);
      const z = hole(id);

      let kaderwert = 0;
      let bekannt = 0;
      for (const pid of z.kader) {
        const w = wertAmTag(mw.get(pid), tag);
        if (w != null) { kaderwert += w; bekannt++; }
      }

      // Der Punkte-Bonus gehört in den Kontostand wie bei jeder Messung.
      // Früher fehlte er hier ganz: Ein zurückgerechneter Tag lag um
      // Punkte × Bonus unter dem gemessenen daneben — im Verlauf ein
      // Einbruch, den es nie gab, und als Vortag ein falscher Pfeil.
      // Wo die Punkte nicht sicher feststehen, bleibt der Kontostand leer
      // statt zu niedrig.
      const punkte = proPunkt === 0 ? 0 : punkteAmTag(tag, gemessen.get(id) ?? [], anpfiffe);

      proTag.set(id, {
        konto: punkte == null ? null
          : startbudget + bonus + punkte * proPunkt + z.saldo + (korrektur.get(m.n) ?? 0),
        punkte: proPunkt === 0 ? null : punkte,

        // **Ein leerer Kader ist 0, ein unbekannter ist nichts.** Fehlt
        // auch nur ein Marktwert, wäre die Summe zu niedrig — und eine zu
        // niedrige Linie sieht aus wie ein Einbruch, den es nie gab.
        // Dann lieber eine Lücke: Die Anzeige lässt sie leer.
        kaderwert:
          z.kader.size === 0 ? 0 : bekannt === z.kader.size ? kaderwert : null,
        spieler: z.kader.size,
        bekannt,
      });
    }
    staende.set(tag, proTag);
  }

  return { tage, staende };
}

// Schreibt die zurückgerechneten Tage in `tagesstand`.
//
// **Gemessene Tage werden nicht überschrieben.** Was beim Aktualisieren
// wirklich abgelesen wurde, ist besser als jede Rückrechnung. Zurück-
// gerechnete dagegen schon: Sie werden besser, sobald eine neue Messung,
// ein nachgeholter Transfer oder ein korrigierter Fehler dazukommt — mit
// `DO NOTHING` blieben sie für immer auf dem Stand ihres ersten Laufs.
export async function schreibeRekonstruktion(leagueId, manager, settings) {
  const { tage, staende, grund } = await rekonstruiereVerlauf(leagueId, manager, settings);
  if (grund) return { geschrieben: 0, tage: 0, grund };

  let geschrieben = 0;
  for (const tag of tage) {
    const proTag = staende.get(tag);
    if (!proTag?.size) continue;
    const ids = [...proTag.keys()];

    const r = await sql`
      INSERT INTO tagesstand
        (league_id, manager_id, tag, teamwert, konto, punkte, rekonstruiert, mw_bekannt, mw_gesamt)
      SELECT ${leagueId}::text, t.mid, ${tag}::date, t.tw, t.ko, t.pk, TRUE, t.bk, t.gs
      FROM UNNEST(
        ${ids}::text[],
        ${ids.map((id) => {
          const w = proTag.get(id).kaderwert;
          return w == null ? null : Math.round(w);
        })}::bigint[],
        ${ids.map((id) => {
          const k = proTag.get(id).konto;
          return k == null ? null : Math.round(k);
        })}::bigint[],
        ${ids.map((id) => proTag.get(id).punkte)}::int[],
        ${ids.map((id) => proTag.get(id).bekannt)}::int[],
        ${ids.map((id) => proTag.get(id).spieler)}::int[]
      ) AS t(mid, tw, ko, pk, bk, gs)
      ON CONFLICT (league_id, manager_id, tag) DO UPDATE SET
        teamwert = EXCLUDED.teamwert, konto = EXCLUDED.konto, punkte = EXCLUDED.punkte,
        mw_bekannt = EXCLUDED.mw_bekannt, mw_gesamt = EXCLUDED.mw_gesamt
      WHERE tagesstand.rekonstruiert = TRUE`;
    geschrieben += r.count ?? 0;
  }

  return { geschrieben, tage: tage.length };
}
