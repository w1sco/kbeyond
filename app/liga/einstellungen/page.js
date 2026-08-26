import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, sql } from "@/lib/db";
import { euro } from "@/lib/format";
import { sitzung, verlangeLiga, istMitglied } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function speichern(formData) {
  "use server";
  const leagueId = formData.get("league");

  // Die Liga-ID kommt aus dem Formular und ist damit manipulierbar. Ohne
  // diese Prüfung könnte jeder Angemeldete die Einstellungen und
  // Korrekturen einer fremden Liga überschreiben.
  const { token } = await sitzung();
  if (!(await istMitglied(leagueId, token))) {
    throw new Error("Kein Zugriff auf diese Liga");
  }

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
  const { token } = await sitzung();

  const p = await searchParams;
  // Kein Fallback auf eine feste Liga-ID: ohne Parameter landete man sonst
  // in den Einstellungen einer fremden Liga.
  if (!p.league) redirect("/liga");
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);

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
    <main className="kb-seite kb-seite--schmal">
      <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
      <h1 className="kb-titel" style={{ margin: "10px 0 20px" }}>Einstellungen · {ranking.ti}</h1>

      <form action={speichern}>
        <input type="hidden" name="league" value={leagueId} />

        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">Grundwerte</h2>

          <label className="kb-feld">
            <span className="kb-feld-name">Startbudget (€)</span>
            <input name="startbudget" type="number" defaultValue={Number(settings.startbudget)} className="kb-eingabe" />
          </label>

          <label className="kb-feld">
            <span className="kb-feld-name">
              Stichtag<small className="kb-feld-hinweis">Transfers davor werden ignoriert</small>
            </span>
            <input name="stichtag" type="datetime-local" defaultValue={datum(settings.stichtag)} className="kb-eingabe" />
          </label>

          <label className="kb-feld">
            <span className="kb-feld-name">Bonus pro Punkt (€)</span>
            <input name="punkte_bonus" type="number" defaultValue={Number(settings.punkte_bonus)} className="kb-eingabe" />
          </label>
        </section>

        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">Login-Bonus</h2>
          <p className="kb-info">
            Annahme: jeder loggt sich täglich ein. 10k am ersten Tag, steigend bis 90k,
            ab Tag 10 konstant 100k.
          </p>

          <label className="kb-feld" style={{ alignItems: "center" }}>
            <span className="kb-feld-name">Aktiv</span>
            <input name="login_aktiv" type="checkbox" defaultChecked={settings.login_aktiv} />
          </label>

          <label className="kb-feld">
            <span className="kb-feld-name">
              Zählung ab<small className="kb-feld-hinweis">leer = ab Stichtag</small>
            </span>
            <input name="login_start" type="date" defaultValue={tag(settings.login_start)} className="kb-eingabe" />
          </label>
        </section>

        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">Korrekturen pro Manager</h2>
          <p className="kb-info">
            Fester Betrag, der auf das berechnete Konto addiert wird. Negative Werte erlaubt.
            Nur nötig, wenn ein einzelner Manager nachweislich abweicht.
          </p>

          <div className="kb-korr-gitter">
            {spieler.map((m) => (
              <label key={m.i} className="kb-korr-zeile">
                <span style={{ fontSize: 13 }}>{m.n}</span>
                <input
                  name={`korr_${m.n}`}
                  type="number"
                  defaultValue={korrekturen.get(m.n) ?? 0}
                  className="kb-eingabe kb-eingabe--klein"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">Notiz</h2>
          <textarea name="notiz" defaultValue={settings.notiz ?? ""} rows={3} className="kb-eingabe kb-eingabe--voll" />
        </section>

        <button type="submit" className="kb-btn kb-btn--stark">Speichern</button>
      </form>

      <p className="kb-legende">
        Aktuell aktiv: {euro(Number(settings.startbudget))} Start ·{" "}
        {euro(Number(settings.punkte_bonus))} pro Punkt ·{" "}
        Login-Bonus {settings.login_aktiv ? "an" : "aus"}
      </p>
    </main>
  );
}
