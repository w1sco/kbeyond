import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, sql } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { euro } from "@/lib/format";

export const dynamic = "force-dynamic";

const MEIN_NAME = "W1zco";

export default async function Liga({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  const leagueId = p.league ?? "6423644";

  await initSchema();

  const overview = await kbFetch(`/v4/leagues/${leagueId}/overview`, token);

  await getSettings(leagueId);

  await sql`
    UPDATE liga_settings
    SET startbudget = ${overview.b},
        stichtag    = ${overview.dt}
    WHERE league_id = ${leagueId}`;

  const settings = await getSettings(leagueId);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const me = await kbFetch(`/v4/leagues/${leagueId}/me`, token);

  const spieler = (ranking.us ?? []).filter((m) => m.adm !== true);

  const konten = await berechneKonten(leagueId, spieler, settings);
  konten.sort((a, b) => b.konto - a.konto);

  const ich = konten.find((k) => k.name === MEIN_NAME);
  const echt = Number(me.b);
  const diff = ich ? ich.konto - echt : null;
  const passt = diff === 0;

  const typen = await sql`
    SELECT type, COUNT(*)::int AS anzahl,
           COUNT(price)::int AS mit_preis,
           COALESCE(SUM(price), 0)::bigint AS summe
    FROM events WHERE league_id = ${leagueId}
    GROUP BY type ORDER BY anzahl DESC`;

  return (
    <main style={S.main}>
      <header style={S.head}>
        <div>
          <h1 style={S.h1}>{ranking.ti}</h1>
          <p style={S.sub}>
            {spieler.length} Manager · Startbudget {euro(Number(settings.startbudget))} · Stichtag{" "}
            {new Date(settings.stichtag).toLocaleDateString("de-DE")} · Login-Tage{" "}
            {konten[0]?.tageGezaehlt ?? "–"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href={`/api/import?league=${leagueId}&zurueck=1`} style={S.btn}>Aktualisieren</a>
          <a href={`/liga/einstellungen?league=${leagueId}`} style={S.btn}>Einstellungen</a>
        </div>
      </header>

      {p.neu !== undefined && (
        <div style={S.hinweis}>{p.neu} neue Events importiert.</div>
      )}
      {p.fehler && (
        <div style={{ ...S.hinweis, color: "#dc2626" }}>Import-Fehler: {p.fehler}</div>
      )}

      <div style={{ ...S.box, borderColor: passt ? "#16a34a" : "#dc2626" }}>
        <strong style={{ fontSize: 14 }}>
          Kalibrierung {passt ? "✓ exakt" : "– Abweichung"}
        </strong>
        <div style={S.grid}>
          <div><span style={S.label}>Berechnet</span>{euro(ich?.konto)}</div>
          <div><span style={S.label}>Echt (API)</span>{euro(echt)}</div>
          <div>
            <span style={S.label}>Differenz</span>
            <strong style={{ color: passt ? "#16a34a" : "#dc2626" }}>{euro(diff)}</strong>
          </div>
        </div>
        {ich && (
          <div style={S.rechnung}>
            {euro(Number(settings.startbudget))} Start
            {" + "}{euro(ich.loginBonus)} Login
            {" + "}{euro(ich.punkteBonus)} Punkte
            {" + "}{euro(ich.verkaeufe)} Verkäufe
            {" − "}{euro(ich.kaeufe)} Käufe
          </div>
        )}
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>#</th>
            <th style={S.th}>Manager</th>
            <th style={S.thR}>Kontostand</th>
            <th style={S.thR}>Käufe</th>
            <th style={S.thR}>Verkäufe</th>
            <th style={S.thR}>Saldo</th>
            <th style={S.thR}>Punkte</th>
          </tr>
        </thead>
        <tbody>
          {konten.map((k, i) => {
            const saldo = k.verkaeufe - k.kaeufe;
            return (
              <tr key={k.id} style={k.name === MEIN_NAME ? { background: "#eff6ff" } : undefined}>
                <td style={S.td}>{i + 1}</td>
                <td style={S.td}>
                  <strong>{k.name}</strong>
                  {k.mehrdeutig && <span style={S.warn}>Name doppelt</span>}
                  {k.anzKauf === 0 && k.anzVerkauf === 0 && (
                    <span style={S.info}>keine Transfers</span>
                  )}
                </td>
                <td style={S.tdR}><strong>{euro(k.konto)}</strong></td>
                <td style={S.tdR}>{euro(k.kaeufe)} <span style={S.muted}>({k.anzKauf})</span></td>
                <td style={S.tdR}>{euro(k.verkaeufe)} <span style={S.muted}>({k.anzVerkauf})</span></td>
                <td style={{ ...S.tdR, color: saldo >= 0 ? "#16a34a" : "#dc2626" }}>{euro(saldo)}</td>
                <td style={S.tdR}>{k.punkte}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
