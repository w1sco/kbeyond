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
  await sql`
    UPDATE liga_settings
    SET startbudget = COALESCE(startbudget, ${overview.b}),
        stichtag    = COALESCE(stichtag, ${overview.dt})
    WHERE league_id = ${leagueId}`;

  const settings = await getSettings(leagueId);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const me = await kbFetch(`/v4/leagues/${leagueId}/me`, token);

  // Admin spielt nicht mit -> raus aus allen Berechnungen
  const spieler = (ranking.us ?? []).filter((m) => m.adm !== true);

  const konten = await berechneKonten(leagueId, spieler, settings);
  konten.sort((a, b) => b.konto - a.konto);

  const ich = konten.find((k) => k.name === MEIN_NAME);
  const echt = Number(me.b);
  const diff = ich ? ich.konto - echt : null;
  const passt = diff === 0;

  // Diagnose: welche Event-Typen liegen überhaupt in der DB?
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
        <a href={`/api/import?league=${leagueId}`} style={S.btn}>Daten aktualisieren</a>
      </header>

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

      <details style={S.details}>
        <summary style={S.summary}>Event-Typen in der Datenbank</summary>
        <table style={{ ...S.table, marginTop: 10 }}>
          <thead>
            <tr>
              <th style={S.th}>Typ</th>
              <th style={S.thR}>Anzahl</th>
              <th style={S.thR}>davon mit Preis</th>
              <th style={S.thR}>Summe</th>
            </tr>
          </thead>
          <tbody>
            {typen.map((t) => (
              <tr key={t.type}>
                <td style={S.td}>
                  {t.type}
                  {t.type === 15 && <span style={S.muted}> Transfer (gezählt)</span>}
                  {t.type === 3 && <span style={S.muted}> Marktangebot</span>}
                  {t.type === 22 && <span style={S.muted}> Login-Bonus</span>}
                </td>
                <td style={S.tdR}>{t.anzahl}</td>
                <td style={S.tdR}>{t.mit_preis}</td>
                <td style={S.tdR}>{euro(Number(t.summe))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </main>
  );
}

const S = {
  main: { maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 },
  h1: { fontSize: 24, margin: 0 },
  sub: { color: "#64748b", fontSize: 13, margin: "6px 0 16px" },
  btn: { fontSize: 13, padding: "7px 12px", border: "1px solid #cbd5e1", borderRadius: 6, textDecoration: "none", color: "#334155", whiteSpace: "nowrap" },
  box: { border: "2px solid", borderRadius: 8, padding: 14, marginBottom: 22 },
  grid: { display: "flex", gap: 32, marginTop: 10, fontSize: 15, flexWrap: "wrap" },
  label: { display: "block", fontSize: 11, textTransform: "uppercase", color: "#64748b", marginBottom: 2 },
  rechnung: { marginTop: 12, paddingTop: 10, borderTop: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e2e8f0", fontSize: 11, textTransform: "uppercase", color: "#64748b" },
  thR: { textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e2e8f0", fontSize: 11, textTransform: "uppercase", color: "#64748b" },
  td: { padding: "9px 10px", borderBottom: "1px solid #f1f5f9" },
  tdR: { padding: "9px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "right" },
  muted: { color: "#94a3b8", fontSize: 12 },
  warn: { color: "#ea580c", fontSize: 11, marginLeft: 6 },
  info: { color: "#94a3b8", fontSize: 11, marginLeft: 6 },
  details: { marginTop: 28 },
  summary: { cursor: "pointer", fontSize: 13, color: "#64748b" },
};
