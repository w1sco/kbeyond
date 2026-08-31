import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getImportStatus, getTeamwerte, getMwTrend, getTagesverlauf, sql, getVortag } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { euro, zeitpunkt, vorZeit, inZeit, fuerTag, MW_UHRZEIT } from "@/lib/format";
import Tabelle from "./Tabelle";
import Frag from "./Frag";
import Verlauf from "./Verlauf";
import Hinweis from "../_ui/Hinweis";
import { sitzung, verlangeLiga, holeLigen, istWeiterleitung } from "@/lib/auth";
import { erlaubtesMinus } from "@/lib/gebot";
import { holeMitspieler } from "@/lib/mitspieler";
import Logo from "@/app/_ui/Logo";

export const dynamic = "force-dynamic";

export default async function Liga({ searchParams }) {
  const { token, nutzer, name: meinName, uid: meineUid, ablauf } = await sitzung();

  const p = await searchParams;
  const leagueId = p.league;

  if (!leagueId) {
    // Über holeLigen: Eine abgelaufene Sitzung führt damit zur Anmeldung
    // statt zu einem Serverfehler.
    //
    // **Alles andere darf hier nicht durchschlagen.** Diese Seite ist der
    // Einstieg: Stirbt sie, ist die ganze App weg, und der Nutzer sieht
    // nur „A server error occurred". Genau das ist passiert, als Kickbase
    // gedrosselt hat. Ein Fehler wird deshalb angezeigt, nicht geworfen.
    let ligen = [];
    let ausfall = null;
    try {
      ligen = await holeLigen(token);
    } catch (e) {
      // Eine abgelaufene Sitzung leitet zur Anmeldung — die darf hier
      // nicht hängen bleiben.
      if (istWeiterleitung(e)) throw e;
      ausfall = e?.gedrosselt
        ? "Kickbase drosselt gerade. Das löst sich von selbst — kurz warten und neu laden."
        : `Kickbase antwortet gerade nicht (${e?.status ?? e?.message ?? "unbekannt"}). Kurz warten und neu laden.`;
    }

    return (
      <main className="kb-seite kb-seite--schmal">
        <h1 className="kb-titel"><Logo gross /></h1>
        <p className="kb-unter" style={{ marginBottom: 16 }}>Liga wählen</p>
        {p.fehler && <div className="kb-hinweis kb-hinweis--fehler">{p.fehler}</div>}
        {ausfall && (
          <div className="kb-hinweis kb-hinweis--warn">
            {ausfall}
            <div style={{ marginTop: 10 }}>
              <Link href="/liga" className="kb-btn kb-btn--klein">Neu laden</Link>
            </div>
          </div>
        )}
        <div className="kb-kacheln kb-kacheln--schmal">
          {ligen.map((l) => (
            <Link key={l.i} href={`/liga?league=${l.i}`} className="kb-kachel">
              <strong>{l.n}</strong>
              <span className="kb-leise">Budget {euro(l.b)} · Teamwert {euro(l.tv)}</span>
            </Link>
          ))}
        </div>
        {!ausfall && ligen.length === 0 && (
          <p className="kb-leise">Keine Ligen gefunden.</p>
        )}
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
  const trend = await getMwTrend(leagueId);
  // Der jüngste Stand vor heute – Grundlage der Platzierungspfeile.
  const vortag = await getVortag(leagueId);

  // Wer einen gespeicherten Kader hat, spielt mit — auch ein Admin. Das
  // fängt den Fall ab, den Teamwert und Punkte nicht abdecken: direkt nach
  // einem Liga-Reset steht beides bei allen auf null.
  const spieler = await holeMitspieler(leagueId, ranking, settings);

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

  const konten = await berechneKonten(leagueId, spieler, settings);

  for (const k of konten) {
    const t = tw.map.get(String(k.id));
    k.teamwert = t?.teamwert ?? 0;
    // Kadergröße = Käufe − Verkäufe. dashboard.t ist NICHT die Kadergröße,
    // sondern die Zahl aller Transfers – daher die unplausiblen 48.
    k.kaderGroesse = k.anzKauf - k.anzVerkauf;
    // Trend = Summe der Marktwert-Bewegungen des eigenen Kaders bei der
    // letzten Anpassung. Kein Transfer kann darin landen.
    const t2 = trend.map.get(String(k.id));
    k.trend = t2?.trend ?? null;
    k.trendAnteil = t2?.anteil ?? null;
    k.trendGestiegen = t2?.gestiegen ?? null;
    k.trendGefallen = t2?.gefallen ?? null;
    k.trendSpieler = t2?.spieler ?? null;
    // (Teamwert + Konto) × 0,33 – der Kontostand steckt in der Basis.
    k.limit = erlaubtesMinus(k.teamwert, k.konto);
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

  // ── Verlauf über die Zeit ──────────────────────────────────────────
  //
  // Grundlage ist `tagesstand`: je Manager und Kalendertag Kaderwert,
  // Kontostand und Punkte. Gemessene Tage stehen dort neben
  // zurückgerechneten — bis zum Liga-Reset zurück, ohne einen einzigen
  // Kickbase-Aufruf.
  const tagesZeilen = await getTagesverlauf(leagueId);

  const verlaufTage = [...new Set(tagesZeilen.map((z) => fuerTag(z.tag)))].sort();

  const reihenFuer = (feld) => {
    const raus = {};
    const nachTag = new Map(verlaufTage.map((t, i) => [t, i]));
    for (const z of tagesZeilen) {
      const wert = z[feld];
      if (wert == null) continue;
      const id = z.managerId;
      if (!raus[id]) raus[id] = new Array(verlaufTage.length).fill(null);
      raus[id][nachTag.get(fuerTag(z.tag))] = wert;
    }
    return raus;
  };

  const gesamtReihen = (() => {
    const raus = {};
    const nachTag = new Map(verlaufTage.map((t, i) => [t, i]));
    for (const z of tagesZeilen) {
      if (z.teamwert == null || z.konto == null) continue;
      if (!raus[z.managerId]) raus[z.managerId] = new Array(verlaufTage.length).fill(null);
      raus[z.managerId][nachTag.get(fuerTag(z.tag))] = z.teamwert + z.konto;
    }
    return raus;
  })();

  const verlaufMasse = [
    { schluessel: "kaderwert", name: "Kaderwert", einheit: "geld", reihen: reihenFuer("teamwert") },
    { schluessel: "gesamtwert", name: "Gesamtwert", einheit: "geld", reihen: gesamtReihen },
    { schluessel: "kontostand", name: "Kontostand", einheit: "geld", reihen: reihenFuer("konto") },
    {
      schluessel: "punkte", name: "Punkte", einheit: "zahl", reihen: reihenFuer("punkte"),
      leerGrund:
        "Punkte werden erst seit dem ersten Aktualisieren mitgeschrieben — " +
        "rückwirkend stehen sie nirgends und werden nicht geschätzt.",
    },
  ];

  const rekonstruierteTage = new Set(
    tagesZeilen.filter((z) => z.rekonstruiert).map((z) => fuerTag(z.tag))
  ).size;

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
          <Aktion pfad="aktualisieren" leagueId={leagueId} haupt>Alles aktualisieren</Aktion>
          <a href={`/liga/live?league=${leagueId}`} className="kb-btn">Live-Punkte</a>
          <a href={`/liga/transfermarkt?league=${leagueId}`} className="kb-btn">Transfermarkt</a>
          <a href={`/liga/markt?league=${leagueId}`} className="kb-btn">Freie Spieler</a>
          <a href={`/liga/aufschlaege?league=${leagueId}`} className="kb-btn">Aufschläge</a>
          <a href={`/liga/news?league=${leagueId}`} className="kb-btn">News</a>
          <a href={`/liga/einstellungen?league=${leagueId}`} className="kb-btn">Einstellungen</a>
          <Link href="/liga" className="kb-btn">Liga wechseln</Link>
        </div>
      </header>

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

      {/* Die Tabelle steht bewusst ganz oben: sie ist das Werkzeug, wegen
          dem man die Seite aufruft. Status, Kalibrierung und Verlauf sind
          Belege und Beiwerk und stehen darunter. */}
      <Tabelle
        konten={JSON.parse(JSON.stringify(konten))}
        vortag={Object.fromEntries(vortag.map)}
        vortagDatum={vortag.tag ? String(vortag.tag) : null}
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
            <strong>MW-Trend</strong> — wie viel die Spieler des Kaders bei der letzten
            Marktwertanpassung zusammen gewonnen oder verloren haben. Kickbase passt die
            Marktwerte täglich um <strong>{MW_UHRZEIT} Uhr</strong> an; die Zahl sagt
            also, ob die eigenen Leute gerade eher steigen oder fallen.
          </p>
          <p>
            <strong>Transfers zählen nicht mit.</strong> Gerechnet wird je Spieler sein
            Marktwert heute minus sein Marktwert gestern — ein Kaufpreis kommt darin
            nirgends vor. Wer für 20 Mio kauft, steht deshalb nicht mit +20 Mio da,
            sondern nur mit der Bewegung, die der Spieler selbst gemacht hat.
          </p>
          <p>
            Gezählt wird nur, wer an <strong>beiden</strong> Tagen einen abgelesenen Wert
            hat. Die Werte stammen aus der eigenen Mitschrift beim Aktualisieren — nach
            der ersten Aktualisierung steht der Trend deshalb auf „–“, ab der zweiten
            am nächsten Marktwert-Tag ist er da. Die aufgeklappte Detailzeile zeigt
            zusätzlich, wie viele Spieler gestiegen und wie viele gefallen sind: Eine
            Summe nahe null kann Stillstand bedeuten oder ein Aufheben von Gewinnen und
            Verlusten.
          </p>
          <p>
            Spaltenüberschrift antippen sortiert, nochmal für die Gegenrichtung. Auf dem
            Handy zeigt die Tabelle nur Gesamtwert, Max-Gebot und Kontostand — das{" "}
            <strong>+</strong> vor dem Namen klappt den Rest mit den genauen Beträgen auf.
            Der Managername führt zur Managerseite.
          </p>
        </Hinweis>
      </div>

      <div className="kb-status">
        {/* Wie lange ein Kickbase-Token gilt, ist nicht dokumentiert. Der
            Wert wird aus dem Token selbst gelesen und hier gezeigt – damit
            steht die Antwort da, statt geschätzt zu werden. */}
        {ablauf && (
          <div>
            <span className="kb-label">Anmeldung gültig bis</span>
            {zeitpunkt(ablauf)}
            <span className="kb-leise"> {inZeit(ablauf)}</span>
          </div>
        )}
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

      <section className="kb-karte">
        <h2 className="kb-abschnitt-titel">
          Verlauf über die Zeit
          <span className="kb-leise">
            {" "}Stand jeweils 0 Uhr
            {rekonstruierteTage > 0 ? ` · ${rekonstruierteTage} Tage zurückgerechnet` : ""}
          </span>
        </h2>
        <Verlauf
          tage={verlaufTage}
          masse={verlaufMasse}
          manager={konten.map((k) => ({ id: k.id, name: k.name }))}
          meineId={treffer.i}
        />
        <Hinweis kurz="Wie der Verlauf entsteht" titel="Teamwert-Verlauf">
          <p>
            Jeder Punkt ist der <strong>letzte bekannte Teamwert vor 0 Uhr</strong> des
            jeweiligen Tages, deutscher Zeit. Nur so sind die Manager vergleichbar —
            gespeichert wird nämlich dann, wenn jemand aktualisiert, und das ist bei jedem
            zu einer anderen Uhrzeit.
          </p>
          <p>
            Eine Linie beginnt erst, wenn für den Manager ein Stand vorliegt. Vorher bleibt
            sie leer statt bei null zu liegen — null wäre eine Aussage, „unbekannt&ldquo; ist die
            Wahrheit.
          </p>
          <p>
            Alle Manager liegen grau im Hintergrund; angeklickte bekommen ihre Farbe. Die
            Farbe hängt fest am Manager, nicht an seinem Rang — eine Auswahl färbt die
            übrigen also nicht um.
          </p>
          <p>
            Die Achse beginnt <strong>nicht bei null</strong>. Sonst lägen alle Linien
            zusammengedrängt am oberen Rand und die täglichen Bewegungen wären unsichtbar.
          </p>
          <p>
            <strong>Käufe und Verkäufe zählen mit hinein:</strong> Ein Zukauf hebt den
            Teamwert, ohne dass ein Marktwert gestiegen wäre.
          </p>
        </Hinweis>
      </section>

      <div style={{ marginTop: 24 }}>
        <Frag leagueId={leagueId} />
      </div>
    </main>
  );
}

// Ein Knopf, der eine schreibende API-Route per POST auslöst.
// `haupt` für die eine Aktion, wegen der man die Seite aufruft. Acht
// gleich aussehende Knöpfe nebeneinander sagen nicht, wo man anfängt.
function Aktion({ pfad, leagueId, haupt = false, children }) {
  return (
    <form action={`/api/${pfad}?league=${leagueId}&zurueck=1`} method="post">
      <button type="submit" className={`kb-btn${haupt ? " kb-btn--haupt" : ""}`}>
        {children}
      </button>
    </form>
  );
}
