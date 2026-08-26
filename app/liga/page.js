import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getImportStatus, sql } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { euro, zeitpunkt, vorZeit } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Liga({ searchParams }) {
  const store = await cookies();
  const token = store.get("kb_token")?.value;
  if (!token) redirect("/login");

  const meinName = store.get("kb_name")?.value ?? null;
  const meineUid = store.get("kb_uid")?.value ?? null;

  const p = await searchParams;
  const leagueId = p.league;

  if (!leagueId) {
    const ligen = await kbFetch("/v4/leagues/selection", token);
    return (
      <main style={S.main}>
        <h1 style={S.h1}>KBeyond</h1>
        <p style={S.sub}>Liga wählen</p>
        <div style={{ display: "grid", gap: 10, maxWidth: 460 }}>
          {(ligen.it ?? []).map((l) => (
            <Link key={l.i} href={`/liga?league=${l.i}`} style={S.ligaCard}>
              <strong>{l.n}</strong>
              <span style={S.muted}>
                Budget {euro(l.b)} · Teamwert {euro(l.tv)}
              </span>
            </Link>
          ))}
        </div>
      </main>
    );
  }

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
  const status = await getImportStatus(leagueId);

  const spieler = (ranking.us ?? []).filter((m) => m.adm !== true);

  const treffer =
    (meineUid && spieler.find((m) => String(m.i) === meineUid)) ||
    (meinName && spieler.find((m) => m.n === meinName)) ||
    null;

  if (!treffer) {
    return (
      <main style={S.main}>
        <h1 style={S.h1}>{ranking.ti}</h1>
        <p style={S.sub}>
          Wer bist du in dieser Liga? Die Auswahl wird gespeichert und dient zur
          Prüfung, ob die Kontostand-Berechnung exakt stimmt.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, maxWidth: 700 }}>
          {spieler.map((m) => (
            <a key={m.i} href={`/api/ich?name=${encodeURIComponent(m.n)}&league=${leagueId}`} style={S.ligaCard}>{m.n}</a>
          ))}
        </div>
      </main>
    );
  }

  const konten = await berechneKonten(leagueId, spieler, settings);
  konten.sort((a, b) => b.konto - a.konto);

  const ich = konten.find((k) => k.id === treffer.i);
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
            Angemeldet als <strong>{ich.name}</strong> · {spieler.length} Manager ·
            Startbudget {euro(Number(settings.startbudget))} · Stichtag{" "}
            {new Date(settings.stichtag).toLocaleDateString("de-DE")} · Login-Tage{" "}
            {konten[0]?.tageGezaehlt ?? "–"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href={`/api/import?league=${leagueId}&zurueck=1`} style={S.btn}>Aktualisieren</a>
          <a href={`/liga/einstellungen?league=${leagueId}`} style={S.btn}>Einstellungen</a>
          <Link href="/liga" style={S.btn}>Liga wechseln</Link>
        </div>
      </header>

      <div style={S.statusLeiste}>
        <div>
          <span style={S.label}>Letzte Aktualisierung</span>
          {zeitpunkt(status.letzterLauf)}
          <span style={S.muted}> {vorZeit(status.letzterLauf)}</span>
        </div>
        <div>
          <span style={S.label}>Neuestes Event</span>
          {zeitpunkt(status.neuestesEvent)}
          <span style={S.muted}> {vorZeit(status.neuestesEvent)}</span>
        </div>
        <div>
          <span style={S.label}>Events gesamt</span>
          {status.gesamt ?? "–"}
        </div>
        <div>
          <span style={S.label}>Import</span>
          {status.komplett ? "vollständig" : `unvollständig (ab ${status.offsetPos})`}
        </div>
      </div>

      {p.neu !== undefined && (
        <div style={S.hinweis}>{p.neu} neue Events importiert.</div>
      )}
      {p.hinweis && (
        <div style={{ ...S.hinweis, background: "#fef3c7" }}>
          {p.hinweis} — nochmal &quot;Aktualisieren&quot; klicken.
        </div>
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
        {!status.komplett && (
          <div style={S.achtung}>
            Import noch unvollständig – die Kontostände stimmen erst, wenn alle Events geladen sind.
          </div>
        )}
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
              <tr key={k.id} style={k.id === treffer.i ? { background: "#eff6ff" } : undefined}>
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
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" },
  h1: { fontSize: 24, margin: 0 },
  sub: { color: "#64748b", fontSize: 13, margin: "6px 0 16px" },
  btn: { fontSize: 13, padding: "7px 12px", border: "1px solid #cbd5e1", borderRadius: 6, textDecoration: "none", color: "#334155", whiteSpace: "nowrap" },
  ligaCard: { display: "flex", flexDirection: "column", gap: 3, padding: 14, border: "1px solid #e2e8f0", borderRadius: 8, textDecoration: "none", color: "inherit" },
  statusLeiste: { display: "flex", gap: 28, padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 16, fontSize: 13, flexWrap: "wrap" },
  hinweis: { padding: "8px 12px", background: "#f1f5f9", borderRadius: 6, fontSize: 13, marginBottom: 14 },
  box: { border: "2px solid", borderRadius: 8, padding: 14, marginBottom: 22 },
  grid: { display: "flex", gap: 32, marginTop: 10, fontSize: 15, flexWrap: "wrap" },
  label: { display: "block", fontSize: 11, textTransform: "uppercase", color: "#64748b", marginBottom: 2 },
  achtung: { marginTop: 10, padding: "7px 10px", background: "#fef3c7", borderRadius: 6, fontSize: 12 },
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
