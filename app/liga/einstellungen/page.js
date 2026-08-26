import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, sql } from "@/lib/db";
import { euro } from "@/lib/format";

export const dynamic = "force-dynamic";

async function speichern(formData) {
  "use server";
  const leagueId = formData.get("league");

  await sql`
    UPDATE liga_settings SET
      startbudget  = ${Number(formData.get("startbudget"))},
      stichtag     = ${formData.get("stichtag")},
      punkte_bonus = ${Number(formData.get("punkte_bonus"))},
      login_aktiv  = ${formData.get("login_aktiv") === "on"},
      login_start  = ${formData.get("login_start") || null},
      notiz        = ${formData.get("notiz") || null}
    WHERE league_id = ${leagueId}`;

  for (const [key, wert] of formData.entries()) {
    if (!key.startsWith("korr_")) continue;
    const manager = key.slice(5);
    const betrag = Number(wert) || 0;
    if (betrag === 0) {
      await sql`DELETE FROM korrektur WHERE league_id = ${leagueId} AND manager = ${manager}`;
    } else {
      await sql`
        INSERT INTO korrektur (league_id, manager, betrag)
        VALUES (${leagueId}, ${manager}, ${betrag})
        ON CONFLICT (league_id, manager) DO UPDATE SET betrag = ${betrag}`;
    }
  }

  revalidatePath("/liga");
  redirect(`/liga?league=${leagueId}`);
}

export default async function Einstellungen({ searchParams }) {
  const token = (await cookies()).get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  const leagueId = p.league ?? "6423644";

  await initSchema();
  const settings = await getSettings(leagueId);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const spieler = (ranking.us ?? []).filter((m) => m.adm !== true);

  const korrekturen = new Map(
    (await sql`SELECT manager, betrag FROM korrektur WHERE league_id = ${leagueId}`)
      .map((r) => [r.manager, Number(r.betrag)])
  );

  const datum = (d) => (d ? new Date(d).toISOString().slice(0, 16) : "");
  const tag = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  return (
    <main style={S.main}>
      <Link href={`/liga?league=${leagueId}`} style={S.back}>← zurück zur Liga</Link>
      <h1 style={S.h1}>Einstellungen · {ranking.ti}</h1>

      <form action={speichern}>
        <input type="hidden" name="league" value={leagueId} />

        <section style={S.card}>
          <h2 style={S.h2}>Grundwerte</h2>

          <label style={S.row}>
            <span style={S.lbl}>Startbudget (€)</span>
            <input name="startbudget" type="number" defaultValue={Number(settings.startbudget)} style={S.input} />
          </label>

          <label style={S.row}>
            <span style={S.lbl}>Stichtag<small style={S.hint}>Transfers davor werden ignoriert</small></span>
            <input name="stichtag" type="datetime-local" defaultValue={datum(settings.stichtag)} style={S.input} />
          </label>

          <label style={S.row}>
            <span style={S.lbl}>Bonus pro Punkt (€)</span>
            <input name="punkte_bonus" type="number" defaultValue={Number(settings.punkte_bonus)} style={S.input} />
          </label>
        </section>

        <section style={S.card}>
          <h2 style={S.h2}>Login-Bonus</h2>
          <p style={S.info}>
            Annahme: jeder loggt sich täglich ein. 10k am ersten Tag, steigend bis 90k,
            ab Tag 10 konstant 100k.
          </p>

          <label style={{ ...S.row, alignItems: "center" }}>
            <span style={S.lbl}>Aktiv</span>
            <input name="login_aktiv" type="checkbox" defaultChecked={settings.login_aktiv} />
          </label>

          <label style={S.row}>
            <span style={S.lbl}>Zählung ab<small style={S.hint}>leer = ab Stichtag</small></span>
            <input name="login_start" type="date" defaultValue={tag(settings.login_start)} style={S.input} />
          </label>
        </section>

        <section style={S.card}>
          <h2 style={S.h2}>Korrekturen pro Manager</h2>
          <p style={S.info}>
            Fester Betrag, der auf das berechnete Konto addiert wird. Negative Werte erlaubt.
            Nur nötig, wenn ein einzelner Manager nachweislich abweicht.
          </p>

          <div style={S.korrGrid}>
            {spieler.map((m) => (
              <label key={m.i} style={S.korrRow}>
                <span style={S.korrName}>{m.n}</span>
                <input
                  name={`korr_${m.n}`}
                  type="number"
                  defaultValue={korrekturen.get(m.n) ?? 0}
                  style={S.korrInput}
                />
              </label>
            ))}
          </div>
        </section>

        <section style={S.card}>
          <h2 style={S.h2}>Notiz</h2>
          <textarea name="notiz" defaultValue={settings.notiz ?? ""} rows={3} style={S.textarea} />
        </section>

        <button type="submit" style={S.btn}>Speichern</button>
      </form>

      <p style={S.foot}>
        Aktuell aktiv: {euro(Number(settings.startbudget))} Start ·{" "}
        {euro(Number(settings.punkte_bonus))} pro Punkt ·{" "}
        Login-Bonus {settings.login_aktiv ? "an" : "aus"}
      </p>
    </main>
  );
}

const S = {
  main: { maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" },
  back: { fontSize: 13, color: "#2563eb", textDecoration: "none" },
  h1: { fontSize: 22, margin: "10px 0 20px" },
  h2: { fontSize: 14, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 0.4, color: "#475569" },
  card: { border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, marginBottom: 16 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 12 },
  lbl: { fontSize: 14, display: "flex", flexDirection: "column" },
  hint: { color: "#94a3b8", fontSize: 11, fontWeight: 400 },
  info: { fontSize: 12, color: "#64748b", margin: "0 0 14px", lineHeight: 1.5 },
  input: { width: 220, padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14 },
  textarea: { width: "100%", padding: 9, border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, fontFamily: "inherit" },
  korrGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 },
  korrRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  korrName: { fontSize: 13 },
  korrInput: { width: 120, padding: "5px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, textAlign: "right" },
  btn: { padding: "10px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 7, fontSize: 14, cursor: "pointer" },
  foot: { marginTop: 18, fontSize: 12, color: "#64748b" },
};
