import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getImportStatus, getTeamwerte, sql } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { euro, zeitpunkt, vorZeit } from "@/lib/format";
import Tabelle from "./Tabelle";
import Frag from "./Frag";
import Hinweis from "../_ui/Hinweis";
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
  // Hier stand mal eine Heuristik, die "Differenz glatt durch 100.000
  // teilbar" als "so viele Tage Login-Bonus" gedeutet hat. Das war Unsinn:
  // Transferpreise sind fast immer glatte Beträge, und so kamen Aussagen
  // wie "227 Tage Login-Bonus" bei einer Liga heraus, die 20 Tage alt ist.
  //
  // Übrig bleiben zwei Prüfungen, die wirklich etwas aussagen, und sonst
  // die ehrliche Aufzählung der beiden wahrscheinlichen Ursachen.
  const proPunkt = Number(settings.punkte_bonus);
  const passtAufPunkte = Boolean(ich) && proPunkt > 0 && diff !== 0 && diff === ich.punkteBonus;

  // Ein Tagesäquivalent nur nennen, wenn es überhaupt in die Laufzeit der
  // Liga passt – mehr Tage als gezählt kann der Bonus nicht erklären.
  const tageAequivalent =
    diff !== 0 && diff % 100_000 === 0 ? diff / 100_000 : null;
  const tagePlausibel =
    tageAequivalent != null && Math.abs(tageAequivalent) <= (ich?.tageGezaehlt ?? 0);

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
        <Hinweis art="warn" kurz="Teamwerte sind alt oder fehlen" titel="Teamwerte veraltet">
          <p>
            Ohne frische Teamwerte stimmen <strong>Max-Gebot</strong>, <strong>Limit</strong>{" "}
            und <strong>Gesamtwert</strong> nicht — sie hängen alle am Teamwert.
          </p>
          <p>Ein Klick auf „Alles aktualisieren“ holt sie nach.</p>
        </Hinweis>
      )}

      {lueckeStd > 0 && (
        <Hinweis
          art="warn"
          kurz={`Datenlücke: ${lueckeTage} Tage fehlen`}
          titel={`Datenlücke: ${lueckeTage} Tage`}
        >
          <p>
            Zwischen Stichtag und Feed-Beginn fehlen {lueckeTage} Tage, die Kickbase nicht
            mehr ausliefert. Transfers aus diesem Zeitraum holt „Alles aktualisieren“
            zurück{status.rekonFertig ? " – das ist erledigt" : " – das läuft dort mit, solange es nicht fertig ist"}.
          </p>
          <p>
            <strong>Strafen lassen sich dagegen nicht nachladen.</strong> Sie hängen an
            keinem Spieler und existieren nur im Feed. Deshalb sind die Kontostände aller
            Manager außer deinem eigenen Näherungen.
          </p>
          <p>
            <strong>Was du tun kannst:</strong> Der Liga-Admin sieht die vollständige
            Historie und kann sagen, wer im fehlenden Zeitraum Strafen bekommen hat. Diese
            Beträge trägst du unter{" "}
            <a href={`/liga/einstellungen?league=${leagueId}`}>Einstellungen</a> als
            Korrektur ein (negativ, z.B. <code>-1000000</code>). Danach stimmen die
            betroffenen Kontostände wieder exakt.
          </p>
        </Hinweis>
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
          <Hinweis
            art="warn"
            kurz="Woran kann die Differenz liegen?"
            titel="Differenz trotz Aktualisierung"
          >
            {passtAufPunkte ? (
              <p>
                Die Differenz entspricht exakt dem gesamten Punkte-Bonus
                ({ich.punkte} Punkte × {euro(proPunkt)}). Dann gibt es diesen Bonus in
                dieser Liga vermutlich nicht — probeweise unter{" "}
                <a href={`/liga/einstellungen?league=${leagueId}`}>Einstellungen</a> den
                Bonus pro Punkt auf 0 setzen.
              </p>
            ) : (
              <>
                <p>
                  Wenn die Zahlen aktuell sind und trotzdem eine Differenz bleibt, kommen
                  vor allem zwei Ursachen infrage:
                </p>
                <p>
                  <strong>Der Login-Bonus.</strong> Die Rechnung unterstellt, dass täglich
                  eingeloggt wird. Ein ausgelassener Tag fehlt dauerhaft — im konstanten
                  Bereich der Staffelung sind das 100.000 € pro Tag. Gezählt wird ab{" "}
                  {zeitpunkt(ich.bonusQuelle === "Stichtag" ? settings.stichtag : settings.login_start)}
                  {" "}({ich.tageGezaehlt} Tage, Quelle: {ich.bonusQuelle}); stimmt der
                  Starttag nicht, lässt er sich unter Einstellungen setzen.
                </p>
                <p>
                  <strong>Eine alte Strafe.</strong> Strafen aus der Zeit vor dem
                  Feed-Fenster liefert Kickbase nicht mehr aus und lassen sich auch nicht
                  rekonstruieren. Der Liga-Admin sieht sie noch; der Betrag kommt dann als
                  Korrektur in die Einstellungen.
                </p>
                {tagePlausibel && (
                  <p>
                    Zur Einordnung: die Differenz entspricht {Math.abs(tageAequivalent)}{" "}
                    {Math.abs(tageAequivalent) === 1 ? "Tag" : "Tagen"} Login-Bonus.
                  </p>
                )}
              </>
            )}
          </Hinweis>
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

      <div style={{ marginTop: 12 }}>
        <Hinweis kurz="Was bedeuten die Spalten?" titel="Die Kennzahlen">
          <p>
            <strong>Kontostand</strong> — das berechnete Guthaben.{" "}
            <strong>Teamwert</strong> — der Wert aller Spieler im Kader.
          </p>
          <p>
            <strong>Limit</strong> = Teamwert ÷ 3, das erlaubte Minus.{" "}
            <strong>Max-Gebot</strong> = Kontostand + Limit, also der höchste Betrag ohne
            vorherigen Verkauf. <strong>Gesamtwert</strong> = Kontostand + Teamwert.
          </p>
          <p>
            <strong>Liquidität</strong> — welcher Anteil des Vermögens flüssig ist.{" "}
            <strong>Anpassungen</strong> — Strafen und manuelle Korrektur zusammen.
          </p>
          <p>
            Spaltenüberschrift antippen sortiert, nochmal für die Gegenrichtung. Auf dem
            Handy zeigt die Tabelle nur Gesamtwert, Max-Gebot und Kontostand — das{" "}
            <strong>+</strong> vor dem Namen klappt den Rest mit den genauen Beträgen auf.
            Der Managername führt zur Managerseite.
          </p>
        </Hinweis>
      </div>
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
