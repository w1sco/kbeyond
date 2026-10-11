import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getTeamwerte, getMwTrend, getKader, getStartelf, sql } from "@/lib/db";
import { berechneKonten, kommendeLoginBoni } from "@/lib/ledger";
import { geheimeZugaenge } from "@/lib/zugang";
import { wenVerbergen, verbergeKonten } from "@/lib/privatsphaere";
import Schloss from "@/app/_ui/Schloss";
import { sitzung, verlangeLiga, istMitglied } from "@/lib/auth";
import { abgleich } from "@/lib/abgleichdaten";
import { leseBetrag } from "@/lib/abgleich";
import { holeNamen, benenne } from "@/lib/spielernamen";
import { holeAufschlaege, aktuellAmMarkt } from "@/lib/marktbeobachtung";
import { werteAus } from "@/lib/aufschlag";
import { euro, euroKurz, prozent, zeitpunkt, normalisiereSpieler, findeSpielerListe, restzeit, tagKurz, ausEingabe, fuerEingabe, fuerTag } from "@/lib/format";
import Verkaufsrechner from "./Verkaufsrechner";
import Aufstellung from "./Aufstellung";
import Blaettern from "./Blaettern";
import Startelflegende from "@/app/_ui/Startelflegende";
import { standStartelf } from "@/lib/startelfabruf";
import { erlaubtesMinus } from "@/lib/gebot";
import { holeMitspieler } from "@/lib/mitspieler";

export const dynamic = "force-dynamic";

// ── Abgleich mit einem echten Kontostand ────────────────────────────
//
// Beide Aktionen prüfen selbst: Sie sind eigene Adressen und lassen sich
// ohne die Seite aufrufen. Und beide verweigern den Abgleich, wenn der
// Manager seine Zahlen vor diesem Betrachter verbirgt — die berechnete
// Zahl stünde sonst als „Differenz“ wieder da.
async function zugangZumAbgleich(formData) {
  const { token, nutzer, uid, name } = await sitzung();
  const leagueId = String(formData.get("league") ?? "");
  const managerId = String(formData.get("manager") ?? "");
  if (!(await istMitglied(leagueId, token))) throw new Error("Kein Zugriff auf diese Liga");
  await initSchema();
  const settings = await getSettings(leagueId, nutzer);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const alle = await holeMitspieler(leagueId, ranking, settings);
  const manager = alle.find((m) => String(m.i) === managerId);
  if (!manager) throw new Error("Manager nicht gefunden");
  const betrachterId = alle.find((m) => (uid && String(m.i) === uid) || (name && m.n === name))?.i ?? null;
  const geheim = wenVerbergen({ zugaenge: await geheimeZugaenge(), spieler: alle, betrachterId });
  if (geheim.has(String(manager.i))) throw new Error("Dieser Manager zeigt seine Zahlen nicht");
  const zurueck = `/liga/manager/${encodeURIComponent(managerId)}?league=${encodeURIComponent(leagueId)}`;
  return { leagueId, nutzer, settings, alle, manager, zurueck };
}

async function kontrollwertSpeichern(formData) {
  "use server";
  const { leagueId, nutzer, manager, zurueck } = await zugangZumAbgleich(formData);
  if (formData.get("loeschen")) {
    await sql`
      DELETE FROM kontrollwert
      WHERE league_id = ${leagueId} AND user_id = ${nutzer} AND manager_id = ${String(manager.i)}`;
    redirect(zurueck);
  }
  const betrag = leseBetrag(formData.get("betrag"));
  const wann = ausEingabe(formData.get("zeitpunkt"));
  if (betrag == null || !wann) {
    redirect(`${zurueck}&abgleich=${encodeURIComponent("Betrag oder Zeitpunkt nicht lesbar")}`);
  }
  await sql`
    INSERT INTO kontrollwert (league_id, user_id, manager_id, betrag, zeitpunkt)
    VALUES (${leagueId}, ${nutzer}, ${String(manager.i)}, ${Math.round(betrag)}, ${wann})
    ON CONFLICT (league_id, user_id, manager_id) DO UPDATE
      SET betrag = EXCLUDED.betrag, zeitpunkt = EXCLUDED.zeitpunkt, eingetragen = NOW()`;
  redirect(`${zurueck}#abgleich`);
}

// Die Differenz als Korrektur: neu gerechnet, nie aus dem Formular.
async function korrekturUebernehmen(formData) {
  "use server";
  const { leagueId, nutzer, settings, alle, manager, zurueck } = await zugangZumAbgleich(formData);
  const a = await abgleich({ leagueId, settings, alle, manager, nutzer });
  if (a && Math.abs(a.diff) >= 1) {
    const grund = `Abgleich mit Kontostand vom ${zeitpunkt(a.zeitpunkt)}`;
    await sql`
      INSERT INTO korrektur (league_id, user_id, manager, betrag, grund)
      VALUES (${leagueId}, ${nutzer}, ${manager.n}, ${Math.round(a.diff)}, ${grund})
      ON CONFLICT (league_id, user_id, manager) DO UPDATE
        SET betrag = korrektur.betrag + ${Math.round(a.diff)}, grund = ${grund}`;
  }
  redirect(`${zurueck}#abgleich`);
}

// Tag d der Login-Staffel als Datum: die d-te Mitternacht nach dem Start.
function loginTag(start, d) {
  const basis = Date.parse(`${fuerTag(start)}T12:00:00Z`);
  return tagKurz(new Date(basis + d * 86_400_000));
}

// Ab hier gilt ein Spieler als Topspieler.
const TOPSPIELER_AB = 25_000_000;

// Wer auf einer Position keinen Spieler darüber hat, hat dort Bedarf.
const BEDARF_UNTER = 10_000_000;

const POSITIONEN = [
  { kuerzel: "TW", name: "Tor" },
  { kuerzel: "ABW", name: "Abwehr" },
  { kuerzel: "MF", name: "Mittelfeld" },
  { kuerzel: "ANG", name: "Sturm" },
];

// imPanel: dieselbe Seite in der Schublade. Dann entfallen der
// Seitenrahmen und der Zurück-Link — die Schublade hat einen eigenen
// Kopf und schließt über ihren eigenen Knopf.
export default async function ManagerSeite({ params, searchParams, imPanel = false }) {
  const { token, nutzer, uid: meineUid, name: meinName } = await sitzung();

  const { id } = await params;
  const p = await searchParams;
  if (!p.league) redirect("/liga");
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);

  await initSchema();

  const settings = await getSettings(leagueId, nutzer);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const alle = await holeMitspieler(leagueId, ranking, settings);
  const manager = alle.find((m) => String(m.i) === String(id));

  if (!manager) {
  return (
      <main className="kb-seite kb-seite--schmal">
        <Link prefetch={false} href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
        <h1 className="kb-titel" style={{ marginTop: 10 }}>Manager nicht gefunden</h1>
        <p className="kb-info">
          In dieser Liga gibt es keinen Manager mit der ID {id}. Möglicherweise wurde er
          entfernt oder die Liga gewechselt.
        </p>
      </main>
    );
  }

  const binIch =
    (meineUid && String(manager.i) === meineUid) || (meinName && manager.n === meinName);

  const meineId = alle.find(
    (m) => (meineUid && String(m.i) === meineUid) || (meinName && m.n === meinName))?.i ?? null;
  const konten = verbergeKonten(
    await berechneKonten(leagueId, alle, settings),
    wenVerbergen({ zugaenge: await geheimeZugaenge(), spieler: alle, betrachterId: meineId }));
  const tw = await getTeamwerte(leagueId);
  const mw = await getMwTrend(leagueId);
  const trend = mw.map.get(String(id)) ?? null;

  // Nachbarn zum Blättern: dieselbe Reihenfolge wie die Ligatabelle in
  // ihrer Grundsortierung — Gesamtwert absteigend. Wer von dort kommt,
  // blättert damit in der Reihenfolge weiter, die er gesehen hat.
  const reihenfolge = konten
    .map((x) => ({
      id: String(x.id),
      name: x.name,
      // Ohne Kontostand gibt es keinen Gesamtwert. Sortiert wird dann
      // nach dem Teamwert allein — die Reihenfolge muss vollständig
      // bleiben, sonst fehlte der Betreffende beim Blättern.
      gesamt: (x.konto ?? 0) + (tw.map.get(String(x.id))?.teamwert ?? 0),
    }))
    .sort((a, b) => b.gesamt - a.gesamt);
  const stelle = reihenfolge.findIndex((x) => x.id === String(id));
  const vorher = stelle > 0 ? reihenfolge[stelle - 1] : null;
  const nachher = stelle >= 0 && stelle < reihenfolge.length - 1 ? reihenfolge[stelle + 1] : null;

  const k = konten.find((x) => String(x.id) === String(id));
  const t = tw.map.get(String(id));
  const teamwert = t?.teamwert ?? 0;
  // Käufe − Verkäufe, nicht dashboard.t (das zählt alle Transfers).
  // Ist der Kader live abrufbar, gewinnt dessen echte Länge.
  const kaderGerechnet = k.anzKauf - k.anzVerkauf;
  // Verbirgt dieser Mensch seine Zahlen vor dem Betrachter? Dann gibt es
  // hier nichts abzuleiten — `null + Zahl` wäre eine Zahl, und die sähe
  // aus wie ein Ergebnis.
  const geheim = k.finanzenGeheim === true;
  const abg = geheim ? null : await abgleich({ leagueId, settings, alle, manager, nutzer });
  const limit = geheim ? null : erlaubtesMinus(teamwert, k.konto);
  const maxGebot = geheim ? null : k.konto + limit;
  const gesamtwert = geheim ? null : k.konto + teamwert;
  const quote = geheim || teamwert <= 0 ? null : k.konto / gesamtwert;

  // Datenlücke: trägt nur noch die „ca.“-Marke am Namen. Der erklärende
  // Kasten stand auf jeder Managerseite und sagte dasselbe wie der
  // Hinweis auf der Ligaseite – einmal reicht.
  const feedStart = (await sql`
    SELECT MIN(dt) AS dt FROM events
    WHERE league_id = ${leagueId} AND id NOT LIKE 'rk%'`)[0]?.dt ?? null;
  const stich = new Date(settings.stichtag);
  const unsicher = !binIch && feedStart && new Date(feedStart) > stich;

  // Was hat dieser Manager über Marktwert gezahlt? Muss vor aufschlagJe
  // stehen — das las die Posten, bevor sie berechnet waren, und die Seite
  // starb mit einem ReferenceError.
  const aufschlag = werteAus(
    (await holeAufschlaege(leagueId, settings.stichtag)).filter((z) => z.buyer === manager.n)
  );

  const aufschlagJe = new Map(
    aufschlag.posten.map((x) => [`${x.player_id}|${new Date(x.dt).getTime()}`, x])
  );

  const transfers = await sql`
    SELECT dt, buyer, seller, price, player_name, player_id, id
    FROM events
    WHERE league_id = ${leagueId} AND type = 15
      AND dt >= ${settings.stichtag}
      AND (buyer = ${manager.n} OR seller = ${manager.n})
    ORDER BY dt DESC`;

  const strafen = await sql`
    SELECT dt, (raw->>'amt')::bigint AS betrag, raw->>'adt' AS grund
    FROM events
    WHERE league_id = ${leagueId} AND type = 29
      AND raw->>'n' = ${manager.n}
    ORDER BY dt DESC`;

  // Kader bevorzugt aus der Datenbank („Kader laden“ auf der Ligaseite).
  // Fehlt er dort, einmalig live holen – dann bleibt die Seite nutzbar,
  // auch wenn noch nie geladen wurde.
  const gespeichert = await getKader(leagueId);
  let kader = gespeichert.proManager.get(String(id)) ?? [];
  let kaderQuelle = kader.length > 0 ? "datenbank" : null;
  let kaderFehler = null;

  if (kader.length === 0) {
    try {
      const squad = await kbFetch(`/v4/leagues/${leagueId}/managers/${id}/squad`, token);
      const namen = await holeNamen(leagueId);
      kader = findeSpielerListe(squad).map(normalisiereSpieler).map((s) => ({
        id: String(s.id),
        name: benenne(s, namen),
        position: s.position,
        marktwert: Number(s.marktwert ?? 0),
        kaufpreis: s.preis == null ? null : Number(s.preis),
        punkte: s.punkte ?? null,
      }));
      if (kader.length > 0) kaderQuelle = "live";
    } catch (e) {
      kaderFehler = e.message;
    }
  }

  // Die Startelf-Chance hängt am Spieler, nicht am Manager — sie kommt
  // deshalb erst hier dazu, egal aus welcher Quelle der Kader stammt.
  const elf = await getStartelf();
  const elfStand = await standStartelf();
  kader = kader.map((s) => ({ ...s, startelf: elf.get(String(s.id)) ?? null }));

  const kaderGroesse = kader.length > 0 ? kader.length : kaderGerechnet;
  const kaderWert = kader.reduce((s, x) => s + Number(x.marktwert ?? 0), 0);

  // ── Kaderprofil: Topspieler und Bedarf je Position ──────────────────
  const topspieler = kader
    .filter((x) => Number(x.marktwert ?? 0) > TOPSPIELER_AB)
    .sort((a, b) => Number(b.marktwert ?? 0) - Number(a.marktwert ?? 0));

  const profil = POSITIONEN.map((pos) => {
    const eigene = kader.filter((x) => x.position === pos.kuerzel);
    const bester = eigene.reduce(
      (b, x) => (b == null || Number(x.marktwert ?? 0) > Number(b.marktwert ?? 0) ? x : b),
      null
    );
    return {
      ...pos,
      anzahl: eigene.length,
      bester,
      bedarf: bester == null || Number(bester.marktwert ?? 0) < BEDARF_UNTER,
    };
  });

  // Spieler ohne erkennbare Position würden den Bedarf verfälschen
  const ohnePosition = kader.filter(
    (x) => !POSITIONEN.some((pos) => pos.kuerzel === x.position)
  ).length;

  const posten = [
    { label: "Startbudget", betrag: Number(settings.startbudget) },
    { label: "Login-Bonus", betrag: k.loginBonus },
    {
      // Ausgezahlt sind nur die Punkte bis zum letzten abgeschlossenen
      // Spieltag; die des laufenden kommen erst Montagabend.
      label: k.punkteOffen
        ? `Punkte-Bonus (${k.punkte - k.punkteOffen} × ${euro(Number(settings.punkte_bonus))}, ausgezahlt)`
        : `Punkte-Bonus (${k.punkte} × ${euro(Number(settings.punkte_bonus))})`,
      betrag: k.punkteBonus,
    },
    { label: `Verkäufe (${k.anzVerkauf})`, betrag: k.verkaeufe },
    { label: `Käufe (${k.anzKauf})`, betrag: -k.kaeufe },
    { label: `Strafen (${k.anzStrafen})`, betrag: k.strafen },
    { label: "Manuelle Korrektur", betrag: k.korrektur },
  ];

  // Bis zum ersten Spiel des Spieltags kommen noch Login-Gutschriften dazu,
  // eine je Mitternacht. Der Bonus wird für alle Manager gleich gerechnet —
  // im Feed ist nur der eigene sichtbar.
  // Wer aus diesem Kader gerade am Transfermarkt steht. Kommt aus der
  // eigenen Mitschrift, kostet also keinen Kickbase-Aufruf; abgelaufene
  // Angebote fallen dabei von selbst heraus.
  const amMarkt = await aktuellAmMarkt(leagueId);

  const boni = kommendeLoginBoni({
    referenz: settings.login_start ?? settings.stichtag,
    spieltagStart: settings.spieltag_start,
    aktiv: settings.login_aktiv,
  });

  return (
    <main className={imPanel ? "kb-seite kb-seite--panel" : "kb-seite"}>
      <header className="kb-kopf">
        <div>
          {!imPanel && (
            <Link prefetch={false} href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          )}
          <h1 className="kb-titel" style={{ marginTop: imPanel ? 0 : 8 }}>
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
          <Blaettern
            leagueId={leagueId}
            vorher={vorher ? { id: vorher.id, name: vorher.name } : null}
            nachher={nachher ? { id: nachher.id, name: nachher.name } : null}
          />
          <Link prefetch={false} href={`/liga/einstellungen?league=${leagueId}`} className="kb-btn">Korrektur eintragen</Link>
        </div>
      </header>

      <div className="kb-status">
        <div>
          <span className="kb-label">Gesamtwert</span>
          {geheim ? <Schloss /> : <strong>{teamwert > 0 ? euro(gesamtwert) : "–"}</strong>}
        </div>
        <div>
          <span className="kb-label">Max-Gebot</span>
          {geheim ? <Schloss /> : teamwert > 0 ? euro(maxGebot) : "–"}
        </div>
        <div>
          <span className="kb-label">Kontostand</span>
          {geheim
            ? <Schloss />
            : <span className={k.konto < 0 ? "kb-minus" : undefined}>{euro(k.konto)}</span>}
        </div>
        <div>
          <span className="kb-label">Liquidität</span>
          {geheim ? <Schloss /> : prozent(quote)}
        </div>
        <div>
          <span className="kb-label">Teamwert</span>
          {teamwert > 0 ? euro(teamwert) : "–"}
        </div>
        <div>
          {/* Dieselbe Zahl wie in der Ligatabelle: die Marktwert-Bewegung
              des Kaders bei der letzten Anpassung, ohne Transfers. */}
          <span className="kb-label">MW-Trend</span>
          {trend == null ? (
            <span className="kb-gedaempft">–</span>
          ) : (
            <span className={trend.trend < 0 ? "kb-minus" : trend.trend > 0 ? "kb-plus" : "kb-gedaempft"}>
              {trend.trend > 0 ? "+" : ""}{euro(trend.trend)}
            </span>
          )}
          {trend && (
            <span className="kb-leise">
              {" "}{trend.gestiegen} ↑ · {trend.gefallen} ↓ von {trend.spieler}
              {" · "}{tagKurz(mw.vortag)} → {tagKurz(mw.tag)}
              {mw.abstand > 1 && <span className="kb-warntext"> ({mw.abstand} Tage)</span>}
            </span>
          )}
        </div>
        <div>
          <span className="kb-label">Spieler</span>
          {kaderGroesse > 0 ? kaderGroesse : "–"}
        </div>
        <div>
          <span className="kb-label">Limit (⅓)</span>
          {limit > 0 ? euro(limit) : "–"}
        </div>
        <div>
          <span className="kb-label">Ø Aufschlag</span>
          {aufschlag.anzahl === 0 ? (
            <span className="kb-gedaempft">–</span>
          ) : (
            <>
              <span className={aufschlag.schnitt > 0 ? "kb-minus" : "kb-plus"}>
                {aufschlag.schnitt > 0 ? "+" : ""}{euroKurz(Math.round(aufschlag.schnitt))}
              </span>
              <span className="kb-leise"> {prozent(aufschlag.relativ)} · {aufschlag.anzahl} Käufe</span>
            </>
          )}
        </div>
      </div>

      {kader.length > 0 && (
        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">
            Kaderprofil
            <span className="kb-leise">
              {" "}Topspieler ab {euro(TOPSPIELER_AB)} · Bedarf unter {euro(BEDARF_UNTER)}
            </span>
          </h2>

          <div className="kb-topspieler">
            <span className="kb-label">
              Topspieler: {topspieler.length}
            </span>
            {topspieler.length === 0 ? (
              <span className="kb-gedaempft">keiner über {euro(TOPSPIELER_AB)}</span>
            ) : (
              <div className="kb-namensband">
                {topspieler.map((x) => (
                  <span key={x.id} className="kb-topchip">
                    {x.name}
                    <span className="kb-leise"> {euroKurz(x.marktwert)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="kb-profil">
            {profil.map((pos) => (
              <div key={pos.kuerzel} className={`kb-posfeld${pos.bedarf ? " kb-posfeld--bedarf" : ""}`}>
                <span className="kb-label">
                  {pos.name}
                  <span className="kb-leise"> {pos.anzahl}</span>
                </span>
                {pos.bester ? (
                  <>
                    <strong>{euroKurz(pos.bester.marktwert)}</strong>
                    <div className="kb-posbester">{pos.bester.name}</div>
                  </>
                ) : (
                  <strong className="kb-minus">kein Spieler</strong>
                )}
                {pos.bedarf && <div className="kb-bedarf">Bedarf</div>}
              </div>
            ))}
          </div>

          {ohnePosition > 0 && (
            <p className="kb-info" style={{ margin: "12px 0 0" }}>
              {ohnePosition} {ohnePosition === 1 ? "Spieler hat" : "Spieler haben"} keine
              erkennbare Position und {ohnePosition === 1 ? "fehlt" : "fehlen"} oben in der
              Aufteilung.
            </p>
          )}
        </section>
      )}

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">Finanzen</h2>
        {geheim ? (
          <p className="kb-info">
            <span aria-hidden="true">🔒 </span>
            <strong>{k.name}</strong> zeigt die eigenen Finanzzahlen nicht. Kader,
            Teamwert und Punkte stehen weiter unten — die sieht man in Kickbase
            ohnehin.
          </p>
        ) : (
        <>
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
        {k.punkteAuszahlung && (
          <p className={`kb-info${k.punkteOffenUnbekannt ? " kb-hinweis kb-hinweis--warn" : ""}`} style={{ margin: "12px 0 0" }}>
            {k.punkteOffenUnbekannt ? (
              <>
                Der laufende Spieltag ist noch nicht ausgezahlt, aber wie viele seiner Punkte
                aussteht, ist unbekannt — der Punkte-Bonus enthält sie deshalb noch.
              </>
            ) : (
              <>
                Noch nicht ausgezahlt: <strong>{k.punkteOffen} Punkte</strong> vom laufenden
                Spieltag = {euro(k.punkteBonusOffen)}. Kickbase zahlt sie voraussichtlich{" "}
                {zeitpunkt(k.punkteAuszahlung)} aus; bis dahin zählen sie nicht im
                Kontostand.
              </>
            )}
          </p>
        )}
        <p className="kb-info" style={{ margin: "12px 0 0" }}>
          Der Login-Bonus ist für alle Manager gleich hochgerechnet ({k.tageGezaehlt} Tage ab{" "}
          {k.bonusQuelle}) – Kickbase liefert im Feed nur den eigenen.
        </p>
        </>
        )}
      </section>

      {!geheim && (
        <section className="kb-karte" id="abgleich">
          <h2 className="kb-abschnitt-titel">Abgleich mit echtem Kontostand</h2>
          <p className="kb-info" style={{ marginTop: 0 }}>
            Hat {manager.n} seinen Kontostand gezeigt (Screenshot)? Betrag und Uhrzeit
            eintragen — gerechnet wird zu genau diesem Zeitpunkt, spätere Käufe zählen
            nicht mit.
          </p>
          {p.abgleich && <div className="kb-hinweis kb-hinweis--warn">{p.abgleich}</div>}
          <form action={kontrollwertSpeichern} className="kb-zeile-form">
            <input type="hidden" name="league" value={leagueId} />
            <input type="hidden" name="manager" value={String(manager.i)} />
            <label className="kb-label">
              Echter Kontostand{" "}
              <input name="betrag" className="kb-eingabe" inputMode="text" placeholder="-4.500.972"
                     defaultValue={abg ? String(abg.echt) : ""} required />
            </label>
            <label className="kb-label">
              abgelesen am{" "}
              <input type="datetime-local" name="zeitpunkt" className="kb-eingabe" required
                     defaultValue={fuerEingabe(abg ? abg.zeitpunkt : new Date())} />
            </label>
            <button type="submit" className="kb-btn">Abgleichen</button>
            {abg && <button type="submit" name="loeschen" value="1" className="kb-btn kb-btn--klein">Löschen</button>}
          </form>

          {abg && (
            <>
              <table className="kb-liste" style={{ marginTop: 12 }}>
                <tbody>
                  <tr><td>Echt, am {zeitpunkt(abg.zeitpunkt)}</td><td className={abg.echt < 0 ? "kb-minus" : undefined}>{euro(abg.echt)}</td></tr>
                  <tr><td>KBeyond zum selben Zeitpunkt</td><td className={abg.berechnet < 0 ? "kb-minus" : undefined}>{euro(abg.berechnet)}</td></tr>
                  <tr className="kb-liste-summe">
                    <td>Differenz (echt − KBeyond)</td>
                    <td className={Math.abs(abg.diff) < 1 ? "kb-plus" : "kb-minus"}>
                      {Math.abs(abg.diff) < 1 ? "stimmt auf den Euro" : euro(abg.diff)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="kb-leise" style={{ margin: "6px 0 0" }}>
                Darin: Login-Bonus {euro(abg.posten.loginBonus)} ({abg.tage} Tage) · Punkte-Bonus{" "}
                {euro(abg.posten.punkteBonus)} ({abg.posten.punkte} Punkte) · Käufe{" "}
                {euro(-abg.posten.kaeufe)} · Verkäufe {euro(abg.posten.verkaeufe)} · Strafen{" "}
                {euro(abg.posten.strafen)} · Korrektur {euro(abg.posten.korrektur)}
              </p>

              {abg.danach.length > 0 && (
                <p className="kb-info">
                  <strong>Nicht mitgerechnet, weil danach:</strong>{" "}
                  {abg.danach.map((x) => `${x.kauf ? "Kauf" : "Verkauf"} ${x.spieler} ${euro(x.kauf ? -x.preis : x.preis)} (${zeitpunkt(x.dt)})`).join(" · ")}
                </p>
              )}
              {abg.punkteUnsicher && (
                <p className="kb-hinweis kb-hinweis--warn">
                  Seit dem Ablesen wurde gespielt. Gerechnet ist mit den Punkten von jetzt —
                  der Punkte-Bonus kann deshalb um die Punkte seither daneben liegen.
                </p>
              )}
              {abg.mehrdeutig && (
                <p className="kb-hinweis kb-hinweis--warn">
                  Ein zweiter Manager heißt genauso — die Transfers lassen sich nicht sicher
                  zuordnen.
                </p>
              )}

              {Math.abs(abg.diff) >= 1 && (
                <>
                  <h3 className="kb-label" style={{ marginTop: 12 }}>Was genau passt</h3>
                  {abg.erklaerungen.length === 0 ? (
                    <p className="kb-info">
                      Keine einzelne Ursache passt auf den Euro — auch kein ausgelassener Login
                      und kein einzelner Transfer. Wahrscheinlich kommen mehrere Dinge zusammen,
                      oder es fehlt ein Transfer ganz (etwa aus einer Feed-Lücke). Die Liste der
                      Transfers unten mit {manager.n}s Kickbase-Verlauf vergleichen hilft.
                    </p>
                  ) : (
                    <ul className="kb-info">
                      {abg.erklaerungen.map((e, i) => (
                        <li key={i}>
                          {e.teile.map((x, j) => (
                            <span key={j}>
                              {j > 0 && " und "}
                              {x.art === "login" && (
                                <>
                                  {x.ausfaelle === 1 ? "ein ausgelassener Login" : "zwei ausgelassene Logins"}{" "}
                                  ({euro(x.betrag)}), am{" "}
                                  {x.varianten.slice(0, 4).map((v) => v.map((d) => loginTag(abg.loginStart, d)).join(" + ")).join(" oder ")}
                                  {x.varianten.length > 4 && ` oder ${x.varianten.length - 4} weiteren`}
                                </>
                              )}
                              {x.art === "transfer" && (
                                <>
                                  {x.transfer.kauf ? "Kauf" : "Verkauf"} {x.transfer.spieler} am{" "}
                                  {zeitpunkt(x.transfer.dt)} ({euro(x.transfer.preis)},{" "}
                                  {x.transfer.quelle === "rk" ? "aus der Rekonstruktion" : "aus dem Feed"})
                                  zählt, gab es so aber nicht
                                </>
                              )}
                              {x.art === "punkte" && (
                                <>Punkte-Bonus um {Math.abs(x.punkte)} Punkte {x.punkte > 0 ? "zu niedrig" : "zu hoch"}</>
                              )}
                            </span>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                  {abg.doppelt.length > 0 && (
                    <p className="kb-hinweis kb-hinweis--warn">
                      Vermutlich doppelt erfasst:{" "}
                      {abg.doppelt.map((d) => `${d.rk.spieler} ${euro(d.rk.preis)} (Feed ${zeitpunkt(d.feed.dt)}, Rekonstruktion ${zeitpunkt(d.rk.dt)})`).join(" · ")}
                    </p>
                  )}
                  <form action={korrekturUebernehmen} style={{ marginTop: 10 }}>
                    <input type="hidden" name="league" value={leagueId} />
                    <input type="hidden" name="manager" value={String(manager.i)} />
                    <button type="submit" className="kb-btn">
                      Differenz {euro(abg.diff)} als Korrektur übernehmen
                    </button>
                    <span className="kb-leise"> — danach stimmt {manager.n} zu diesem Zeitpunkt auf den Euro</span>
                  </form>
                </>
              )}
            </>
          )}
        </section>
      )}

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">
          Kader und Verkaufsrechner
          {kader.length > 0 && (
            <span className="kb-leise">
              {" "}{kader.length} Spieler · {euro(kaderWert)} Marktwert
              {kaderQuelle === "live" && " · live geladen"}
            </span>
          )}
        </h2>

        {kaderFehler && <p className="kb-info">Kader nicht abrufbar: {kaderFehler}</p>}

        {!kaderFehler && kader.length === 0 && (
          <p className="kb-info">
            Kein Kader gespeichert und Kickbase liefert gerade keine auswertbare Liste.
            Über „Kader laden“ auf der Ligaseite lässt sich das nachholen; den Rohaufbau
            der Antwort zeigt die{" "}
            <Link prefetch={false} href={`/manager?league=${leagueId}&uid=${id}`}>Manager-Diagnose</Link>.
          </p>
        )}

        {kader.length > 0 && geheim && (
          <p className="kb-info">
            Der Verkaufsrechner rechnet mit dem Kontostand — und der ist hier nicht
            sichtbar. Der Kader steht darunter.
          </p>
        )}

        {kader.length > 0 && !geheim && (
          <>
            <p className="kb-info">
              Spieler anklicken heißt „verkaufen“. Gerechnet wird mit dem Marktwert — beim
              Verkauf an Kickbase ist das der Erlös, bei einem Mitspieler kann dessen Gebot
              darüber liegen.
            </p>
            <Startelflegende stand={elfStand} leagueId={leagueId} />
            <Verkaufsrechner
              kader={kader}
              konto={k.konto}
              teamwert={teamwert}
              boni={boni}
              amMarkt={Object.fromEntries(
                [...amMarkt].map(([id, bis]) => [id, restzeit((bis - Date.now()) / 1000)])
              )}
            />
          </>
        )}
      </section>

      {kader.length > 0 && (
        <section className="kb-karte">
          <h2 className="kb-abschnitt-titel">
            Wahrscheinliche Aufstellung
            <span className="kb-leise"> elf Spieler wählen</span>
          </h2>
          <Aufstellung kader={JSON.parse(JSON.stringify(kader))} />
        </section>
      )}

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
                  <th className="kb-sek">Aufschlag</th>
                  <th>Datum</th>
                  <th className="kb-sek">Quelle</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((z, i) => {
                  const kauf = z.buyer === manager.n;
                  return (
                    <tr key={z.id} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                      <td className="kb-namensspalte">
                        <span className="kb-spielername">{z.player_name ?? "–"}</span>
                      </td>
                      <td>{kauf ? "Kauf" : "Verkauf"}</td>
                      <td className={kauf ? "kb-minus" : undefined}>
                        {kauf ? "−" : "+"}{euro(Number(z.price))}
                      </td>
                      <td className="kb-sek">
                        {(() => {
                          const a = aufschlagJe.get(`${z.player_id}|${new Date(z.dt).getTime()}`);
                          if (!a) return <span className="kb-gedaempft">–</span>;
                          return (
                            <span className={a.aufschlag > 0 ? "kb-minus" : "kb-plus"}>
                              {a.aufschlag > 0 ? "+" : ""}{euroKurz(a.aufschlag)}
                            </span>
                          );
                        })()}
                      </td>
                      <td>{zeitpunkt(z.dt)}</td>
                      <td className="kb-sek kb-gedaempft">
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
