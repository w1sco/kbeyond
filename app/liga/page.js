import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getImportStatus, getTeamwerte, sql } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { euro, zeitpunkt, vorZeit } from "@/lib/format";
import Tabelle from "./Tabelle";
import Frag from "./Frag";
import { sitzung, verlangeLiga } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Liga({ searchParams }) {
  const { token, nutzer, name: meinName, uid: meineUid } = await sitzung();

  const p = await searchParams;
  const leagueId = p.league;

  if (!leagueId) {
    const ligen = await kbFetch("/v4/leagues/selection", token);
    return (
      <main className="kb-seite kb-seite--schmal">
        <h1 className="kb-titel">KBeyond</h1>
        <p className="kb-unter" style={{ marginBottom: 16 }}>Liga wählen</p>
        {p.fehler && <div className="kb-hinweis kb-hinweis--fehler">{p.fehler}</div>}
        <div className="kb-kacheln kb-kacheln--schmal">
          {(ligen.it ?? []).map((l) => (
            <Link key={l.i} href={`/liga?league=${l.i}`} className="kb-kachel">
              <strong>{l.n}</strong>
              <span className="kb-leise">Budget {euro(l.b)} · Teamwert {euro(l.tv)}</span>
            </Link>
          ))}
        </div>
      </main>
    );
  }

  await verlangeLiga(leagueId, token);
  await initSchema();

  const overview = await kbFetch(`/v4/leagues/${leagueId}/overview`, token);
  await getSettings(leagueId, nutzer);
  // Nur füllen, was leer ist – eine frühere Version hat hier bei jedem
  // Aufruf überschrieben und damit jede manuelle Korrektur verworfen.
  await sql`
    UPDATE liga_settings
    SET startbudget = COALESCE(startbudget, ${overview.b}),
        stichtag    = COALESCE(stichtag, ${overview.dt})
    WHERE league_id = ${leagueId} AND user_id = ${nutzer}`;

  const settings = await getSettings(leagueId, nutzer);
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
      <main className="kb-seite">
        <h1 className="kb-titel">{ranking.ti}</h1>
        <p className="kb-unter" style={{ marginBottom: 16 }}>Wer bist du in dieser Liga?</p>
        <div className="kb-kacheln">
          {spieler.map((m) => (
            <form
              key={m.i}
              action={`/api/ich?name=${encodeURIComponent(m.n)}&league=${leagueId}`}
              method="post"
            >
              <button type="submit" className="kb-kachel kb-kachel--knopf">{m.n}</button>
            </form>
          ))}
        </div>
      </main>
    );
  }

  const konten = await berechneKonten(leagueId, spieler, settings, treffer.n);

  for (const k of konten) {
    const t = tw.map.get(String(k.id));
    k.teamwert = t?.teamwert ?? 0;
    // Kadergröße = Käufe − Verkäufe. dashboard.t ist NICHT die Kadergröße,
    // sondern die Zahl aller Transfers – daher die unplausiblen 48.
    k.kaderGroesse = k.anzKauf - k.anzVerkauf;
    k.limit = Math.floor(k.teamwert / 3);
    k.maxGebot = k.konto + k.limit;
  }

  const ich = konten.find((k) => k.id === treffer.i);
  const echt = Number(me.b);
  const diff = ich ? ich.konto - echt : null;
  const passt = diff === 0;

  // Woher kommt eine Abweichung?
  //
  // Zwei Posten der Formel wachsen von allein, ohne dass jemand Code oder
  // Einstellungen anfasst: der Login-Bonus mit jedem Kalendertag (im
  // konstanten Bereich 100.000 €/Tag) und der Punkte-Bonus mit jedem
  // Spieltag. Eine Differenz, die über Nacht wächst, kommt fast immer aus
  // einem der beiden — nicht aus den Transfers.
  const proPunkt = Number(settings.punkte_bonus);
  const passtAufPunkte = ich && proPunkt > 0 && diff === ich.punkteBonus && diff !== 0;
  const passtAufTage = diff !== 0 && diff % 100_000 === 0 && settings.login_aktiv;
  const inPunkten = proPunkt > 0 ? diff / proPunkt : null;

  const stich = new Date(settings.stichtag);
  const feedStart = status.feedStart ? new Date(status.feedStart) : null;
  const lueckeStd = feedStart && feedStart > stich ? (feedStart - stich) / 3_600_000 : 0;
  const lueckeTage = Math.round((lueckeStd / 24) * 10) / 10;

  const kaderStand = (await sql`
    SELECT MAX(stand) AS stand FROM kader WHERE league_id = ${leagueId}`)[0]?.stand ?? null;

  const twVeraltet = !tw.stand || Date.now() - new Date(tw.stand) > 6 * 3600_000;

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <h1 className="kb-titel">{ranking.ti}</h1>
          <p className="kb-unter">
            Angemeldet als <strong>{ich.name}</strong> · {spieler.length} Manager ·
            Startbudget {euro(Number(settings.startbudget))} · Stichtag {zeitpunkt(settings.stichtag)}
          </p>
        </div>
        <div className="kb-aktionen">
          {/* Formulare statt Links: ein GET, das Daten verändert, lässt sich
              von einer fremden Seite aus auslösen. */}
          <Aktion pfad="aktualisieren" leagueId={leagueId}>Alles aktualisieren</Aktion>
          <a href={`/liga/markt?league=${leagueId}`} className="kb-btn">Markt</a>
          <a href={`/liga/einstellungen?league=${leagueId}`} className="kb-btn">Einstellungen</a>
          <Link href="/liga" className="kb-btn">Liga wechseln</Link>
        </div>
      </header>

      <div className="kb-status">
        <div>
          <span className="kb-label">Letzte Aktualisierung</span>
          {zeitpunkt(status.letzterLauf)}
          <span className="kb-leise"> {vorZeit(status.letzterLauf)}</span>
        </div>
        <div>
          <span className="kb-label">Feed zurück bis</span>
          {zeitpunkt(status.feedStart)}
        </div>
        <div>
          <span className="kb-label">Events</span>
          {status.gesamt}
        </div>
        <div>
          <span className="kb-label">Rekonstruiert</span>
          {status.rekonGefunden}
          <span className="kb-leise">
            {status.rekonFertig ? " (fertig)" : status.rekonPosition > 0 ? ` (bei ${status.rekonPosition})` : ""}
          </span>
        </div>
        <div>
          <span className="kb-label">Teamwerte</span>
          {tw.stand ? zeitpunkt(tw.stand) : "nie geladen"}
        </div>
        <div>
          <span className="kb-label">Kader</span>
          {kaderStand ? zeitpunkt(kaderStand) : "nie geladen"}
        </div>
      </div>

      {twVeraltet && (
        <div className="kb-hinweis kb-hinweis--warn">
          Teamwerte fehlen oder sind älter als 6 Stunden – Liquidität und Max-Gebot stimmen erst
          nach einem Klick auf &quot;Alles aktualisieren&quot;.
        </div>
      )}

      {lueckeStd > 0 && (
        <div className="kb-luecke">
          <strong>Datenlücke: {lueckeTage} Tage</strong>
          <p>
            Zwischen Stichtag und Feed-Beginn fehlen {lueckeTage} Tage, die Kickbase nicht mehr
            ausliefert. Transfers aus diesem Zeitraum holt &quot;Historie nachladen&quot;
            zurück{status.rekonFertig ? " – das ist erledigt" : " – das läuft bei „Alles aktualisieren“ mit, solange es nicht fertig ist"}.
            {" "}Strafen lassen sich dagegen nicht automatisch nachladen: Sie hängen an keinem
            Spieler und existieren nur im Feed.
          </p>
          <p>
            <strong>Was du tun kannst:</strong> Der Liga-Admin sieht die vollständige Historie
            und kann dir sagen, wer im fehlenden Zeitraum Strafen bekommen hat. Diese Beträge
            trägst du unter{" "}
            <a href={`/liga/einstellungen?league=${leagueId}`}>Einstellungen</a>
            {" "}als Korrektur ein (negativ, z.B. <code>-1000000</code>). Danach stimmen die
            betroffenen Kontostände wieder exakt.
          </p>
        </div>
      )}

      {p.neu !== undefined && <div className="kb-hinweis">{p.neu} neue Events importiert.</div>}
      {p.tw && <div className="kb-hinweis kb-hinweis--gut">{p.tw}</div>}
      {p.rekon && <div className="kb-hinweis kb-hinweis--info">{p.rekon}</div>}
      {p.hinweis && <div className="kb-hinweis kb-hinweis--warn">{p.hinweis} — nochmal klicken.</div>}
      {p.fehler && <div className="kb-hinweis kb-hinweis--fehler">Fehler: {p.fehler}</div>}

      <div className={`kb-kalib ${passt ? "kb-kalib--ok" : "kb-kalib--fehler"}`}>
        <strong className="kb-kalib-titel">Kalibrierung {passt ? "✓ exakt" : "– Abweichung"}</strong>
        <div className="kb-kennzahlen">
          <div><span className="kb-label">Berechnet</span>{euro(ich?.konto)}</div>
          <div><span className="kb-label">Echt (API)</span>{euro(echt)}</div>
          <div>
            <span className="kb-label">Differenz</span>
            <strong style={{ color: passt ? "var(--kb-gut)" : "var(--kb-schlecht)" }}>{euro(diff)}</strong>
          </div>
        </div>
        {!passt && ich && (
          <div className="kb-verdacht">
            {passtAufPunkte ? (
              <>
                <strong>Die Differenz ist exakt der gesamte Punkte-Bonus.</strong> Dann gibt es
                diesen Bonus in dieser Liga vermutlich nicht: {ich.punkte} Punkte ×{" "}
                {euro(proPunkt)} = {euro(ich.punkteBonus)}. Probeweise unter{" "}
                <a href={`/liga/einstellungen?league=${leagueId}`}>Einstellungen</a> den Bonus
                pro Punkt auf 0 setzen — steht die Differenz danach auf 0 €, war es das.
              </>
            ) : passtAufTage ? (
              <>
                <strong>Die Differenz sind genau {diff / 100_000} Tage Login-Bonus.</strong>{" "}
                Gezählt wird ab {zeitpunkt(ich.bonusQuelle === "Stichtag" ? settings.stichtag : settings.login_start)}
                {" "}({ich.tageGezaehlt} Tage, Quelle: {ich.bonusQuelle}). Stimmt der Starttag
                nicht, wächst die Differenz jeden Tag um weitere 100.000 €. Eine feste
                Korrektur hilft dagegen nur heute — der Starttag ist die dauerhafte Lösung.
              </>
            ) : (
              <>
                Die Differenz entspricht{" "}
                {inPunkten != null && <>{inPunkten.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Punkten à {euro(proPunkt)}</>}
                {inPunkten != null && " oder "}
                {(diff / 100_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Tagen
                Login-Bonus. Beide Posten wachsen von allein — der Login-Bonus täglich, der
                Punkte-Bonus mit jedem Spieltag.
              </>
            )}
          </div>
        )}

        {ich && (
          <div className="kb-rechnung">
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

      <Frag leagueId={leagueId} />

      <Tabelle
        konten={JSON.parse(JSON.stringify(konten))}
        meineId={treffer.i}
        unsicher={lueckeStd > 0}
        leagueId={leagueId}
      />

      <p className="kb-legende">
        Managernamen führen zur Managerseite mit Finanzen, Transfers und Kader.
        Spaltenüberschrift antippen zum Sortieren, nochmal für die Gegenrichtung. Auf dem
        Handy zeigt die Tabelle nur Gesamtwert, Max-Gebot und Kontostand – das{" "}
        <strong>+</strong> vor dem Namen klappt den Rest auf. ·
        {" "}<strong>Gesamtwert</strong> = Kontostand + Teamwert, das Gesamtvermögen ·
        {" "}<strong>Max-Gebot</strong> = Kontostand + Limit, der höchste Betrag ohne
        vorherigen Verkauf ·
        {" "}<strong>Limit</strong> = erlaubtes Minus (ein Drittel des Teamwerts) ·
        {" "}<strong>Liquidität</strong> = Anteil des Vermögens, der flüssig ist ·
        {" "}<strong>Anpassungen</strong> = Strafen und manuelle Korrektur zusammen
      </p>
    </main>
  );
}

// Ein Knopf, der eine schreibende API-Route per POST auslöst.
function Aktion({ pfad, leagueId, children }) {
  return (
    <form action={`/api/${pfad}?league=${leagueId}&zurueck=1`} method="post">
      <button type="submit" className="kb-btn">{children}</button>
    </form>
  );
}
