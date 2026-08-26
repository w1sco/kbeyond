import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getImportStatus, getTeamwerte, sql } from "@/lib/db";
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
              <span style={S.muted}>Budget {euro(l.b)} · Teamwert {euro(l.tv)}</span>
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
    SET startbudget = COALESCE(startbudget, ${overview.b}),
        stichtag    = COALESCE(stichtag, ${overview.dt})
    WHERE league_id = ${leagueId}`;

  const settings = await getSettings(leagueId);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const me = await kbFetch(`/v4/leagues/${leagueId}/me`, token);
  const status = await getImportStatus(leagueId);
  const tw = await getTeamwerte(leagueId);

  const spieler = (ranking.us ?? []).filter((m) => m.adm !== true);

  const treffer =
    (meineUid && spieler.find((m) => String(m.i) === meineUid)) ||
    (meinName && spieler.find((m) => m.n === meinName)) ||
    null;

  if (!treffer) {
    return (
      <main style={S.main}>
        <h1 style={S.h1}>{ranking.ti}</h1>
        <p style={S.sub}>Wer bist du in dieser Liga?</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, maxWidth: 700 }}>
          {spieler.map((m) => (
            <a key={m.i} href={`/api/ich?name=${encodeURIComponent(m.n)}&league=${leagueId}`} style={S.ligaCard}>{m.n}</a>
          ))}
        </div>
      </main>
    );
  }

  const konten = await berechneKonten(leagueId, spieler, settings, treffer.n);

  // Teamwert, Liquidität und Max-Gebot ergänzen
  for (const k of konten) {
    const t = tw.map.get(String(k.id));
    k.teamwert = t?.teamwert ?? 0;
    k.kaderGroesse = t?.spieler ?? 0;
    k.limit = Math.floor(k.teamwert / 3);
    k.maxGebot = k.konto + k.limit;
  }
  konten.sort((a, b) => b.maxGebot - a.maxGebot);

  const ich = konten.find((k) => k.id === treffer.i);
  const echt = Number(me.b);
  const diff = ich ? ich.konto - echt : null;
  const passt = diff === 0;

  const stich = new Date(settings.stichtag);
  const feedStart = status.feedStart ? new Date(status.feedStart) : null;
  const lueckeStd = feedStart && feedStart > stich ? (feedStart - stich) / 3_600_000 : 0;
  const lueckeTage = Math.round((lueckeStd / 24) * 10) / 10;

  const feedTage = feedStart ? Math.max(1, (Date.now() - feedStart) / 86_400_000) : 1;
  const strafenSchaetzung = lueckeStd > 0
    ? Math.round((status.strafenAnzahl / feedTage) * (lueckeStd / 24))
    : 0;
  const strafenSchnitt = status.strafenAnzahl > 0 ? status.strafenSumme / status.strafenAnzahl : 0;

  const twVeraltet = !tw.stand || Date.now() - new Date(tw.stand) > 6 * 3600_000;

  return (
    <main style={S.main}>
      <header style={S.head}>
        <div>
          <h1 style={S.h1}>{ranking.ti}</h1>
          <p style={S.sub}>
            Angemeldet als <strong>{ich.name}</strong> · {spieler.length} Manager ·
            Startbudget {euro(Number(settings.startbudget))} · Stichtag {zeitpunkt(settings.stichtag)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href={`/api/import?league=${leagueId}&zurueck=1`} style={S.btn}>Aktualisieren</a>
          <a href={`/api/teamwerte?league=${leagueId}&zurueck=1`} style={S.btn}>Teamwerte laden</a>
          <a href={`/api/rekonstruieren?league=${leagueId}&zurueck=1`} style={S.btn}>Historie nachladen</a>
          <a href={`/liga/einstellungen?league=${leagueId}`} style={S.btn}>Einstellungen</a>
          <Link href="/liga" style={S.btn}>Liga wechseln</Link>
        </div>
      </header>

      <div style={S.statusLeiste}>
        <div>
          <span style={S.label}>Letzte Aktualisierung</span>
          {zeitpunkt(status.letzterLauf)}<span style={S.muted}> {vorZeit(status.letzterLauf)}</span>
        </div>
        <div>
          <span style={S.label}>Feed zurück bis</span>
          {zeitpunkt(status.feedStart)}
        </div>
        <div>
          <span style={S.label}>Events</span>
          {status.gesamt}
        </div>
        <div>
          <span style={S.label}>Rekonstruiert</span>
          {status.rekonGefunden}
          <span style={S.muted}>{status.rekonFertig ? " (fertig)" : status.rekonPosition > 0 ? ` (bei ${status.rekonPosition})` : ""}</span>
        </div>
        <div>
          <span style={S.label}>Teamwerte</span>
          {tw.stand ? zeitpunkt(tw.stand) : "nie geladen"}
        </div>
      </div>

      {twVeraltet && (
        <div style={{ ...S.hinweis, background: "#fef3c7" }}>
          Teamwerte fehlen oder sind älter als 6 Stunden – Liquidität und Max-Gebot stimmen erst
          nach einem Klick auf &quot;Teamwerte laden&quot;.
        </div>
      )}

      {lueckeStd > 0 && (
        <div style={S.datenluecke}>
          <strong>Datenlücke: {lueckeTage} Tage</strong>
          <div style={{ marginTop: 6, lineHeight: 1.6 }}>
            Zwischen Stichtag und Feed-Beginn fehlen {lueckeTage} Tage. Transfers holt
            &quot;Historie nachladen&quot; zurück{status.rekonFertig ? " (erledigt)" : " – noch offen"}.
            Strafen aus diesem Zeitraum sind dauerhaft verloren.
            {strafenSchaetzung > 0 && (
              <> Hochgerechnet fehlen etwa {strafenSchaetzung} Strafen
              (rund {euro(Math.abs(strafenSchaetzung * strafenSchnitt))} über alle Manager).</>
            )}
            {" "}Gegnerwerte sind deshalb Näherungen.
          </div>
        </div>
      )}

      {p.neu !== undefined && <div style={S.hinweis}>{p.neu} neue Events importiert.</div>}
      {p.tw && <div style={{ ...S.hinweis, background: "#dcfce7" }}>{p.tw}</div>}
      {p.rekon && <div style={{ ...S.hinweis, background: "#dbeafe" }}>{p.rekon}</div>}
      {p.hinweis && <div style={{ ...S.hinweis, background: "#fef3c7" }}>{p.hinweis} — nochmal klicken.</div>}
      {p.fehler && <div style={{ ...S.hinweis, color: "#dc2626" }}>Fehler: {p.fehler}</div>}

      <div style={{ ...S.box, borderColor: passt ? "#16a34a" : "#dc2626" }}>
        <strong style={{ fontSize: 14 }}>Kalibrierung {passt ? "✓ exakt" : "– Abweichung"}</strong>
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
            {ich.strafen !== 0 && <> {" "}{euro(ich.strafen)} Strafen</>}
            {ich.korrektur !== 0 && <> {" + "}{euro(ich.korrektur)} Korrektur</>}
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>#</th>
              <th style={S.th}>Manager</th>
              <th style={S.thR}>Liquidität</th>
              <th style={S.thR}>Teamwert</th>
              <th style={S.thR}>Limit (⅓)</th>
              <th style={S.thR}>Max-Gebot</th>
              <th style={S.thR}>Käufe</th>
              <th style={S.thR}>Verkäufe</th>
              <th style={S.thR}>Strafen</th>
              <th style={S.thR}>Korrektur</th>
            </tr>
          </thead>
          <tbody>
            {konten.map((k, i) => {
              const binIch = k.id === treffer.i;
              return (
                <tr key={k.id} style={binIch ? { background: "#eff6ff" } : undefined}>
                  <td style={S.td}>{i + 1}</td>
                  <td style={S.td}>
                    <strong>{k.name}</strong>
                    {binIch && <span style={S.ok2}>exakt</span>}
                    {!binIch && lueckeStd > 0 && <span style={S.circa}>ca.</span>}
                    {k.mehrdeutig && <span style={S.warn}>Name doppelt</span>}
                  </td>
                  <td style={{ ...S.tdR, color: k.konto < 0 ? "#dc2626" : "inherit" }}>
                    {!binIch && lueckeStd > 0 && <span style={S.muted}>~ </span>}
                    {euro(k.konto)}
                  </td>
                  <td style={S.tdR}>
                    {k.teamwert > 0 ? euro(k.teamwert) : "–"}
                    {k.kaderGroesse > 0 && <span style={S.muted}> ({k.kaderGroesse})</span>}
                  </td>
                  <td style={{ ...S.tdR, color: "#94a3b8" }}>
                    {k.limit > 0 ? euro(k.limit) : "–"}
                  </td>
                  <td style={S.tdR}>
                    <strong style={{ color: "#0f172a" }}>
                      {k.teamwert > 0 ? euro(k.maxGebot) : "–"}
                    </strong>
                  </td>
                  <td style={S.tdR}>{euro(k.kaeufe)} <span style={S.muted}>({k.anzKauf})</span></td>
                  <td style={S.tdR}>{euro(k.verkaeufe)} <span style={S.muted}>({k.anzVerkauf})</span></td>
                  <td style={{ ...S.tdR, color: k.strafen < 0 ? "#dc2626" : "#94a3b8" }}>
                    {k.anzStrafen > 0 ? `${euro(k.strafen)} (${k.anzStrafen})` : "–"}
                  </td>
                  <td style={{ ...S.tdR, color: k.korrektur !== 0 ? "#7c3aed" : "#94a3b8" }}>
                    {k.korrektur !== 0 ? euro(k.korrektur) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={S.legende}>
        <strong>Liquidität</strong> = freies Guthaben ·
        {" "}<strong>Limit</strong> = erlaubtes Minus (ein Drittel des Teamwerts) ·
        {" "}<strong>Max-Gebot</strong> = Liquidität + Limit, also der höchste Betrag, den
        ein Manager ohne vorherigen Verkauf bieten kann.
      </p>
    </main>
  );
}

const S = {
  main: { maxWidth: 1300, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" },
  h1: { fontSize: 24, margin: 0 },
  sub: { color: "#64748b", fontSize: 13, margin: "6px 0 16px" },
  btn: { fontSize: 13, padding: "7px 12px", border: "1px solid #cbd5e1", borderRadius: 6, textDecoration: "none", color: "#334155", whiteSpace: "nowrap" },
  ligaCard: { display: "flex", flexDirection: "column", gap: 3, padding: 14, border: "1px solid #e2e8f0", borderRadius: 8, textDecoration: "none", color: "inherit" },
  statusLeiste: { display: "flex", gap: 24, padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 16, fontSize: 13, flexWrap: "wrap" },
  datenluecke: { padding: "12px 14px", background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, fontSize: 13, marginBottom: 16 },
  hinweis: { padding: "8px 12px", background: "#f1f5f9", borderRadius: 6, fontSize: 13, marginBottom: 14 },
  box: { border: "2px solid", borderRadius: 8, padding: 14, marginBottom: 22 },
  grid: { display: "flex", gap: 32, marginTop: 10, fontSize: 15, flexWrap: "wrap" },
  label: { display: "block", fontSize: 11, textTransform: "uppercase", color: "#64748b", marginBottom: 2 },
  rechnung: { marginTop: 12, paddingTop: 10, borderTop: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e2e8f0", fontSize: 11, textTransform: "uppercase", color: "#64748b", whiteSpace: "nowrap" },
  thR: { textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e2e8f0", fontSize: 11, textTransform: "uppercase", color: "#64748b", whiteSpace: "nowrap" },
  td: { padding: "9px 10px", borderBottom: "1px solid #f1f5f9" },
  tdR: { padding: "9px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "right", whiteSpace: "nowrap" },
  muted: { color: "#94a3b8", fontSize: 12 },
  ok2: { color: "#16a34a", fontSize: 10, marginLeft: 6, textTransform: "uppercase" },
  circa: { color: "#ea580c", fontSize: 10, marginLeft: 6, textTransform: "uppercase" },
  warn: { color: "#ea580c", fontSize: 11, marginLeft: 6 },
  legende: { marginTop: 14, fontSize: 12, color: "#64748b", lineHeight: 1.6 },
};
