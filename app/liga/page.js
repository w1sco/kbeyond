import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getImportStatus, getTeamwerte, sql } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { euro, zeitpunkt, vorZeit } from "@/lib/format";
import Tabelle from "./Tabelle";

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

  for (const k of konten) {
    const t = tw.map.get(String(k.id));
    k.teamwert = t?.teamwert ?? 0;
    k.kaderGroesse = t?.spieler ?? 0;
    k.limit = Math.floor(k.teamwert / 3);
    k.maxGebot = k.konto + k.limit;
  }

  const ich = konten.find((k) => k.id === treffer.i);
  const echt = Number(me.b);
  const diff = ich ? ich.konto - echt : null;
  const passt = diff === 0;

  const stich = new Date(settings.stichtag);
  const feedStart = status.feedStart ? new Date(status.feedStart) : null;
  const lueckeStd = feedStart && feedStart > stich ? (feedStart - stich) / 3_600_000 : 0;
  const lueckeTage = Math.round((lueckeStd / 24) * 10) / 10;

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
            Zwischen Stichtag und Feed-Beginn fehlen {lueckeTage} Tage, die Kickbase nicht mehr
            ausliefert. Transfers aus diesem Zeitraum holt &quot;Historie nachladen&quot;
            zurück{status.rekonFertig ? " – das ist erledigt" : " – das ist noch offen"}.
            {" "}Strafen lassen sich dagegen nicht automatisch nachladen: Sie hängen an keinem
            Spieler und existieren nur im Feed.
          </div>
          <div style={{ marginTop: 8, lineHeight: 1.6 }}>
            <strong>Was du tun kannst:</strong> Der Liga-Admin sieht die vollständige Historie
            und kann dir sagen, wer im fehlenden Zeitraum Strafen bekommen hat. Diese Beträge
            trägst du unter{" "}
            <a href={`/liga/einstellungen?league=${leagueId}`} style={S.linkInline}>Einstellungen</a>
            {" "}als Korrektur ein (negativ, z.B. <code>-1000000</code>). Danach stimmen die
            betroffenen Kontostände wieder exakt.
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

      <Tabelle
        konten={JSON.parse(JSON.stringify(konten))}
        meineId={treffer.i}
        unsicher={lueckeStd > 0}
      />

            <p style={S.legende}>
        Spaltenüberschrift antippen zum Sortieren, nochmal für die Gegenrichtung. ·
        {" "}<strong>Gesamtwert</strong> = Liquidität + Teamwert, das Gesamtvermögen ·
        {" "}<strong>Max-Gebot</strong> = Liquidität + Limit, der höchste Betrag ohne
        vorherigen Verkauf ·
        {" "}<strong>Limit</strong> = erlaubtes Minus (ein Drittel des Teamwerts)
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
  linkInline: { color: "#0f172a", textDecoration: "underline" },
  hinweis: { padding: "8px 12px", background: "#f1f5f9", borderRadius: 6, fontSize: 13, marginBottom: 14 },
  box: { border: "2px solid", borderRadius: 8, padding: 14, marginBottom: 22 },
  grid: { display: "flex", gap: 32, marginTop: 10, fontSize: 15, flexWrap: "wrap" },
  label: { display: "block", fontSize: 11, textTransform: "uppercase", color: "#64748b", marginBottom: 2 },
  rechnung: { marginTop: 12, paddingTop: 10, borderTop: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" },
  muted: { color: "#94a3b8", fontSize: 12 },
  legende: { marginTop: 14, fontSize: 12, color: "#64748b", lineHeight: 1.6 },
};
