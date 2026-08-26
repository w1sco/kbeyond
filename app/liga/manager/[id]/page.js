import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getTeamwerte, sql } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { verlangeLiga } from "@/lib/auth";
import { euro, prozent, zeitpunkt, normalisiereSpieler, findeSpielerListe } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ManagerSeite({ params, searchParams }) {
  const store = await cookies();
  const token = store.get("kb_token")?.value;
  if (!token) redirect("/login");

  const { id } = await params;
  const p = await searchParams;
  if (!p.league) redirect("/liga");
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);

  await initSchema();

  const settings = await getSettings(leagueId);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const alle = (ranking.us ?? []).filter((m) => m.adm !== true);
  const manager = alle.find((m) => String(m.i) === String(id));

  if (!manager) {
    return (
      <main className="kb-seite kb-seite--schmal">
        <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
        <h1 className="kb-titel" style={{ marginTop: 10 }}>Manager nicht gefunden</h1>
        <p className="kb-info">
          In dieser Liga gibt es keinen Manager mit der ID {id}. Möglicherweise wurde er
          entfernt oder die Liga gewechselt.
        </p>
      </main>
    );
  }

  const meineUid = store.get("kb_uid")?.value ?? null;
  const meinName = store.get("kb_name")?.value ?? null;
  const binIch =
    (meineUid && String(manager.i) === meineUid) || (meinName && manager.n === meinName);

  const konten = await berechneKonten(leagueId, alle, settings, manager.n);
  const tw = await getTeamwerte(leagueId);

  const k = konten.find((x) => String(x.id) === String(id));
  const t = tw.map.get(String(id));
  const teamwert = t?.teamwert ?? 0;
  // Käufe − Verkäufe, nicht dashboard.t (das zählt alle Transfers).
  // Ist der Kader live abrufbar, gewinnt dessen echte Länge.
  const kaderGerechnet = k.anzKauf - k.anzVerkauf;
  const limit = Math.floor(teamwert / 3);
  const maxGebot = k.konto + limit;
  const gesamtwert = k.konto + teamwert;
  const quote = teamwert > 0 ? k.konto / gesamtwert : null;

  // Datenlücke: dieselbe Rechnung wie auf der Ligaseite
  const feedStart = (await sql`
    SELECT MIN(dt) AS dt FROM events
    WHERE league_id = ${leagueId} AND id NOT LIKE 'rk%'`)[0]?.dt ?? null;
  const stich = new Date(settings.stichtag);
  const unsicher = !binIch && feedStart && new Date(feedStart) > stich;

  const transfers = await sql`
    SELECT dt, buyer, seller, price, player_name, id
    FROM events
    WHERE league_id = ${leagueId} AND type = 15
      AND (buyer = ${manager.n} OR seller = ${manager.n})
    ORDER BY dt DESC`;

  const strafen = await sql`
    SELECT dt, (raw->>'amt')::bigint AS betrag, raw->>'adt' AS grund
    FROM events
    WHERE league_id = ${leagueId} AND type = 29
      AND raw->>'n' = ${manager.n}
    ORDER BY dt DESC`;

  // Kader live von Kickbase – steht in keiner Tabelle. Schlägt der Abruf
  // fehl, bleibt der Rest der Seite trotzdem nutzbar.
  let kader = [];
  let kaderFehler = null;
  try {
    const squad = await kbFetch(`/v4/leagues/${leagueId}/managers/${id}/squad`, token);
    kader = findeSpielerListe(squad).map(normalisiereSpieler);
  } catch (e) {
    kaderFehler = e.message;
  }

  const kaderGroesse = kader.length > 0 ? kader.length : kaderGerechnet;
  const kaderWert = kader.reduce((s, x) => s + Number(x.marktwert ?? 0), 0);
  const kaderEinkauf = kader.reduce((s, x) => s + Number(x.preis ?? 0), 0);

  const posten = [
    { label: "Startbudget", betrag: Number(settings.startbudget) },
    { label: "Login-Bonus", betrag: k.loginBonus },
    { label: `Punkte-Bonus (${k.punkte} × ${euro(Number(settings.punkte_bonus))})`, betrag: k.punkteBonus },
    { label: `Verkäufe (${k.anzVerkauf})`, betrag: k.verkaeufe },
    { label: `Käufe (${k.anzKauf})`, betrag: -k.kaeufe },
    { label: `Strafen (${k.anzStrafen})`, betrag: k.strafen },
    { label: "Manuelle Korrektur", betrag: k.korrektur },
  ];

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>
            {manager.n}
            {binIch && <span className="kb-marke kb-marke--exakt">exakt</span>}
            {unsicher && <span className="kb-marke kb-marke--circa">ca.</span>}
          </h1>
          <p className="kb-unter">
            {ranking.ti} · Platz {manager.spl ?? "–"} · {k.punkte} Punkte
            {k.mehrdeutig && " · Achtung: Name kommt mehrfach vor"}
          </p>
        </div>
        <div className="kb-aktionen">
          <Link href={`/liga/einstellungen?league=${leagueId}`} className="kb-btn">Korrektur eintragen</Link>
        </div>
      </header>

      {unsicher && (
        <div className="kb-hinweis kb-hinweis--warn">
          Diese Liga hat eine Datenlücke. Die Zahlen sind eine Näherung – Strafen aus dem
          fehlenden Zeitraum kennt Kickbase nicht mehr.
        </div>
      )}

      <div className="kb-status">
        <div>
          <span className="kb-label">Gesamtwert</span>
          <strong>{teamwert > 0 ? euro(gesamtwert) : "–"}</strong>
        </div>
        <div>
          <span className="kb-label">Max-Gebot</span>
          {teamwert > 0 ? euro(maxGebot) : "–"}
        </div>
        <div>
          <span className="kb-label">Kontostand</span>
          <span className={k.konto < 0 ? "kb-minus" : undefined}>{euro(k.konto)}</span>
        </div>
        <div>
          <span className="kb-label">Liquidität</span>
          {prozent(quote)}
        </div>
        <div>
          <span className="kb-label">Teamwert</span>
          {teamwert > 0 ? euro(teamwert) : "–"}
        </div>
        <div>
          <span className="kb-label">Spieler</span>
          {kaderGroesse > 0 ? kaderGroesse : "–"}
        </div>
        <div>
          <span className="kb-label">Limit (⅓)</span>
          {limit > 0 ? euro(limit) : "–"}
        </div>
      </div>

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">Finanzen</h2>
        <table className="kb-liste">
          <tbody>
            {posten.map((z) => (
              <tr key={z.label}>
                <td>{z.label}</td>
                <td className={z.betrag < 0 ? "kb-minus" : undefined}>{euro(z.betrag)}</td>
              </tr>
            ))}
            <tr className="kb-liste-summe">
              <td>Kontostand</td>
              <td className={k.konto < 0 ? "kb-minus" : undefined}>{euro(k.konto)}</td>
            </tr>
          </tbody>
        </table>
        <p className="kb-info" style={{ margin: "12px 0 0" }}>
          Der Login-Bonus ist für alle Manager gleich hochgerechnet ({k.tageGezaehlt} Tage ab{" "}
          {k.bonusQuelle}) – Kickbase liefert im Feed nur den eigenen.
        </p>
      </section>

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">
          Kader {kader.length > 0 && <span className="kb-leise">{kader.length} Spieler · {euro(kaderWert)} Marktwert · {euro(kaderEinkauf)} eingekauft</span>}
        </h2>

        {kaderFehler && (
          <p className="kb-info">Kader nicht abrufbar: {kaderFehler}</p>
        )}

        {!kaderFehler && kader.length === 0 && (
          <p className="kb-info">
            Kickbase hat für diesen Manager keine Kaderliste geliefert, die sich auswerten
            lässt. Der Rohaufbau der Antwort steht unter{" "}
            <Link href={`/manager?league=${leagueId}&uid=${id}`}>Manager-Diagnose</Link>.
          </p>
        )}

        {kader.length > 0 && (
          <div className="kb-tabellenrahmen">
            <table className="kb-tabelle kb-tabelle--schmal">
              <thead>
                <tr>
                  <th className="kb-namensspalte">Spieler</th>
                  <th>Pos.</th>
                  <th>Marktwert</th>
                  <th>Kaufpreis</th>
                  <th>Gewinn</th>
                  <th>Punkte</th>
                </tr>
              </thead>
              <tbody>
                {kader.map((s, i) => {
                  const gewinn = s.preis != null ? Number(s.marktwert ?? 0) - Number(s.preis) : null;
                  return (
                    <tr key={s.id ?? i} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                      <td className="kb-namensspalte">{s.name}</td>
                      <td>{s.position}</td>
                      <td>{euro(s.marktwert)}</td>
                      <td>{s.preis != null ? euro(s.preis) : "–"}</td>
                      <td className={gewinn < 0 ? "kb-minus" : undefined}>
                        {gewinn != null ? euro(gewinn) : "–"}
                      </td>
                      <td>{s.punkte ?? "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">
          Transfers <span className="kb-leise">{k.anzKauf} Käufe · {k.anzVerkauf} Verkäufe · Saldo {euro(k.verkaeufe - k.kaeufe)}</span>
        </h2>

        {transfers.length === 0 ? (
          <p className="kb-info">Keine Transfers im gespeicherten Zeitraum.</p>
        ) : (
          <div className="kb-tabellenrahmen">
            <table className="kb-tabelle kb-tabelle--schmal">
              <thead>
                <tr>
                  <th className="kb-namensspalte">Spieler</th>
                  <th>Richtung</th>
                  <th>Preis</th>
                  <th>Datum</th>
                  <th>Quelle</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((z, i) => {
                  const kauf = z.buyer === manager.n;
                  return (
                    <tr key={z.id} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                      <td className="kb-namensspalte">{z.player_name ?? "–"}</td>
                      <td>{kauf ? "Kauf" : "Verkauf"}</td>
                      <td className={kauf ? "kb-minus" : undefined}>
                        {kauf ? "−" : "+"}{euro(Number(z.price))}
                      </td>
                      <td>{zeitpunkt(z.dt)}</td>
                      <td className="kb-gedaempft">
                        {String(z.id).startsWith("rk") ? "rekonstruiert" : "Feed"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {strafen.length > 0 && (
        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">Strafen</h2>
          <table className="kb-liste">
            <tbody>
              {strafen.map((z, i) => (
                <tr key={i}>
                  <td>{zeitpunkt(z.dt)}<span className="kb-leise"> {z.grund ?? ""}</span></td>
                  <td className="kb-minus">{euro(Number(z.betrag))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
