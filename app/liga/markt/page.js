import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getKader, getBesitz, getTeamwerte } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { holePoolGecached } from "@/lib/rekonstruktion";
import { sammleBeobachtungen, aktuellAmMarkt, letzteVerkaeufe, holeAufschlaege } from "@/lib/marktbeobachtung";
import { werteAus } from "@/lib/aufschlag";
import { bildeAuftritte, abstaendeAus, schaetzeZyklus, prognostiziere, MINDEST_ABSTAENDE, BASIS_ZYKLUS_TAGE } from "@/lib/rhythmus";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { euro, prozent, zeitpunkt } from "@/lib/format";
import Freieliste from "./Freieliste";
import Hinweis from "../../_ui/Hinweis";

export const dynamic = "force-dynamic";

// Schwellen für den Filter: unter einer Million liegen die Spieler, die
// niemand haben will — die verzerren das Verhältnis nach oben.
const SCHWELLEN = [
  { wert: 0, label: "alle" },
  { wert: 500_000, label: "ab 500 Tsd" },
  { wert: 1_000_000, label: "ab 1 Mio" },
  { wert: 3_000_000, label: "ab 3 Mio" },
  { wert: 5_000_000, label: "ab 5 Mio" },
  { wert: 10_000_000, label: "ab 10 Mio" },
  { wert: 15_000_000, label: "ab 15 Mio" },
  { wert: 20_000_000, label: "ab 20 Mio" },
];

export default async function Markt({ searchParams }) {
  const { token, nutzer, uid: meineUid, name: meinName } = await sitzung();

  const p = await searchParams;
  if (!p.league) redirect("/liga");
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);

  await initSchema();

  const settings = await getSettings(leagueId, nutzer);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const manager = (ranking.us ?? []).filter((m) => m.adm !== true);

  const konten = await berechneKonten(leagueId, manager, settings);
  const tw = await getTeamwerte(leagueId);
  const kader = await getKader(leagueId);
  const besitz = await getBesitz(leagueId);
  const pool = await holePoolGecached(token);

  // ── Rhythmus: wann kommt wer wieder auf den Markt? ──────────────────
  const { beobachtungen, fremdangebote } = await sammleBeobachtungen(leagueId, settings.stichtag);
  const amMarkt = await aktuellAmMarkt(leagueId);
  const verkauft = await letzteVerkaeufe(leagueId, settings.stichtag);

  const auftritteJe = new Map();
  const alleAbstaende = [];
  for (const [id, zeiten] of beobachtungen) {
    const auftritte = bildeAuftritte(zeiten);
    auftritteJe.set(id, auftritte);
    alleAbstaende.push(...abstaendeAus(auftritte));
  }
  const zyklus = schaetzeZyklus(alleAbstaende);

  // Der Kaufrechner rechnet mit meinem Konto – wer "ich" bin, steht im Cookie.
  const ich = konten.find(
    (k) => (meineUid && String(k.id) === meineUid) || (meinName && k.name === meinName)
  ) ?? null;
  const meinTeamwert = ich ? tw.map.get(String(ich.id))?.teamwert ?? 0 : 0;

  // Der gemessene Liga-Aufschlag als Vorschlag für den Regler
  const aufLiga = werteAus(await holeAufschlaege(leagueId, settings.stichtag));

  // Kaufkraft der Liga: Kontostände plus das erlaubte Minus (Teamwert ÷ 3)
  const summeKonten = konten.reduce((s, k) => s + k.konto, 0);
  const summeLimit = konten.reduce((s, k) => {
    const t = tw.map.get(String(k.id));
    return s + Math.floor((t?.teamwert ?? 0) / 3);
  }, 0);

  // Ein Spieler gilt als vergeben, wenn ihn ein gespeicherter Kader führt
  // ODER sein letzter Transfer einen Käufer hatte. Die zweite Quelle braucht
  // keinen API-Abruf und trägt auch dann, wenn die Kaderliste von Kickbase in
  // einem Format kommt, das wir nicht auswerten können.
  const vergeben = new Set([...kader.besetzt, ...besitz.besitzer.keys()]);

  const jetzt = new Date();
  const frei = pool.spieler
    .filter((s) => !vergeben.has(String(s.id)))
    .map((s) => ({
      ...s,
      marktwert: s.marktwert == null ? null : Number(s.marktwert),
      prognose: prognostiziere({
        auftritte: auftritteJe.get(String(s.id)) ?? [],
        verkauftAm: verkauft.get(String(s.id)) ?? null,
        zyklusTage: zyklus.tage,
        jetzt,
        aufMarktBis: amMarkt.get(String(s.id)) ?? null,
      }),
    }));

  const ohneWert = frei.filter((s) => s.marktwert == null).length;
  const schwelle = Number(p.min ?? 0);
  const gefiltert = frei.filter((s) => (s.marktwert ?? 0) >= schwelle);
  const summeFrei = gefiltert.reduce((s, x) => s + (x.marktwert ?? 0), 0);

  const nurAusEvents = [...besitz.besitzer.keys()].filter((id) => !kader.besetzt.has(id)).length;
  const quellenLeer = vergeben.size === 0;
  const verhaeltnis = summeFrei > 0 ? summeKonten / summeFrei : null;

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Markt · {ranking.ti}</h1>
          <p className="kb-unter">
            Spieler, die keinem Manager gehören — also bei Kickbase liegen.
            {" "}Pool vom {zeitpunkt(pool.stand)}
            {kader.stand && ` · Kader vom ${zeitpunkt(kader.stand)}`}
          </p>
        </div>
        <div className="kb-aktionen">
          {/* Dieselbe gebündelte Aktion wie auf der Ligaseite – sie kommt
              nur hierher zurück statt dorthin. Ein eigener "Kader laden"
              lag hier noch aus der Zeit vor der Bündelung. */}
          <form action={`/api/aktualisieren?league=${leagueId}&zurueck=1&ziel=markt`} method="post">
            <button type="submit" className="kb-btn">Alles aktualisieren</button>
          </form>
        </div>
      </header>

      {p.tw && <div className="kb-hinweis">{p.tw}</div>}
      {p.fehler && <div className="kb-hinweis kb-hinweis--fehler">Fehler: {p.fehler}</div>}

      {quellenLeer && (
        <Hinweis art="warn" kurz="Noch keine Zuordnung — jeder gilt als frei" titel="Keine Daten zur Zuordnung">
          <p>
            Weder Kader noch Transfers sind gespeichert, deshalb gilt hier gerade{" "}
            <strong>jeder</strong> Spieler als frei und das Verhältnis unten ist wertlos.
          </p>
          <p>Auf der Ligaseite „Alles aktualisieren“ klicken, dann stimmt die Rechnung.</p>
        </Hinweis>
      )}

      {!quellenLeer && kader.zeilen.length === 0 && (
        <Hinweis kurz="Zuordnung stammt nur aus Transfers" titel="Woher die Zuordnung stammt">
          <p>
            Wem ein Spieler gehört, kommt hier allein aus den Transfers
            ({besitz.besitzer.size} Spieler) — gespeicherte Kader gibt es noch keine.
          </p>
          <p>
            Der Haken: Spieler, die seit dem Liga-Reset nie gehandelt wurden, gelten dadurch
            fälschlich als frei. „Alles aktualisieren“ oben lädt die Kader nach; klappt
            das nicht, zeigt die{" "}
            <Link href={`/manager?league=${leagueId}&uid=${manager[0]?.i ?? ""}`}>
              Manager-Diagnose
            </Link>{" "}
            was Kickbase stattdessen liefert.
          </p>
        </Hinweis>
      )}

      {ohneWert > 0 && (
        <Hinweis art="warn" kurz={`${ohneWert} freie Spieler ohne Marktwert`} titel="Fehlende Marktwerte">
          <p>
            Für {ohneWert} der {frei.length} freien Spieler liefert Kickbase im Vereinskader
            keinen Marktwert.
          </p>
          <p>
            Die zählen unten als 0 € und fehlen damit in der Summe — das Verhältnis fällt
            dadurch etwas zu günstig aus.
          </p>
        </Hinweis>
      )}

      <div className="kb-status">
        <div>
          <span className="kb-label">Freie Spieler</span>
          <strong>{gefiltert.length}</strong>
          <span className="kb-leise"> von {frei.length}</span>
        </div>
        <div>
          <span className="kb-label">Vergeben</span>
          {vergeben.size}
          <span className="kb-leise">
            {" "}({kader.besetzt.size} aus Kadern{nurAusEvents > 0 ? `, ${nurAusEvents} nur aus Transfers` : ""})
          </span>
        </div>
        <div>
          <span className="kb-label">Marktwert davon</span>
          <strong>{euro(summeFrei)}</strong>
        </div>
        <div>
          <span className="kb-label">Kontostände aller Manager</span>
          <strong className={summeKonten < 0 ? "kb-minus" : undefined}>{euro(summeKonten)}</strong>
        </div>
        <div>
          <span className="kb-label">Rhythmus</span>
          {zyklus.tage
            ? <><strong>~{zyklus.tage.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Tage</strong>
                <span className="kb-leise"> aus {zyklus.anzahl} Abständen</span></>
            : <><strong>{BASIS_ZYKLUS_TAGE} Tage</strong>
                <span className="kb-leise"> angenommen, noch nicht gemessen</span></>}
        </div>
        <div>
          <span className="kb-label">Verhältnis</span>
          <strong>{verhaeltnis == null ? "–" : prozent(verhaeltnis)}</strong>
        </div>
        <div>
          <span className="kb-label">Mit erlaubtem Minus</span>
          {euro(summeKonten + summeLimit)}
          <span className="kb-leise">
            {" "}{summeFrei > 0 ? prozent((summeKonten + summeLimit) / summeFrei) : ""}
          </span>
        </div>
      </div>

      <Hinweis kurz="Wie die Rückkehr-Prognose entsteht" titel="Wann kommt ein Spieler wieder?">
        <p>
          Spieler kehren nach einem festen Rhythmus auf den Markt zurück — anfangs etwa alle
          14 Tage. Je leerer der Markt wird, desto schneller kommen sie wieder, deshalb wird
          der Rhythmus laufend neu aus den <strong>jüngsten</strong> Abständen geschätzt.
        </p>
        <p>
          <strong>Nur Angebote von Kickbase zählen.</strong> Stellt ein Mitspieler einen
          Spieler ein, folgt das keinem Rhythmus, sondern seiner Laune — wer kauft und zwei
          Tage später wieder anbietet, erzeugt einen Abstand von zwei Tagen. Genug davon
          drücken den Median nach unten, und dann steht überall „überfällig&ldquo;, obwohl der
          echte Rhythmus 14 Tage ist. Ob ein Spieler frei war, sagt der letzte Transfer
          davor: hatte er einen Käufer, lag der Spieler in einem Kader.
          {fremdangebote > 0 && ` In dieser Liga sind so ${fremdangebote} Auftritte ausgeschlossen.`}
        </p>
        <p>
          Gezählt wird das <strong>Erscheinen</strong> am Markt, nicht der Kauf. Ein Spieler
          kann ungekauft ablaufen und 14 Tage später wiederkommen und dann gekauft werden —
          zwischen den Käufen lägen 28 Tage, der Rhythmus ist aber 14. Erscheinen und Kauf
          desselben Angebots zählen als ein Auftritt.
        </p>
        <p>
          Alles vor dem Stichtag bleibt draußen: die Historie vor dem Liga-Reset sagt über
          den heutigen Rhythmus nichts.
        </p>
        <p>
          <strong>„kommt demnächst&ldquo;</strong> heißt: seit dem Reset noch nicht am Markt
          gewesen. Diese Spieler tauchen in den nächsten Tagen auf, aber ohne festen
          Abstand — der erste Auftritt nach einem Reset folgt keinem Rhythmus.
        </p>
        <p>
          <strong>Ein Verkauf setzt die Uhr neu.</strong> Wer gekauft und wieder an Kickbase
          verkauft wurde, geht zurück in den Pool und kommt von dort nach dem Rhythmus
          wieder. Verankert wird deshalb am letzten Ereignis, das den Spieler frei gemacht
          hat: sein letzter Auftritt am Markt oder sein Verkauf — je nachdem, was später war.
        </p>
        <p>
          Solange weniger als {MINDEST_ABSTAENDE} Abstände beobachtet sind, wird mit dem
          bekannten Startwert von {BASIS_ZYKLUS_TAGE} Tagen gerechnet und die Prognose als{" "}
          <strong>Annahme</strong> gekennzeichnet. Sobald genug gemessen ist, ersetzt der
          gemessene Rhythmus die Annahme. Abstände, die grob ein Vielfaches des Medians
          sind, werden verworfen: sie kommen von Auftritten, die niemand mitbekommen hat.
        </p>
      </Hinweis>

      <Hinweis kurz="Wie das Verhältnis zu lesen ist" titel="Verhältnis und Filter">
        <p>
          <strong>Verhältnis</strong> = Kontostände aller Manager ÷ Marktwert der freien
          Spieler im gewählten Bereich. Über 100 % heißt: die Liga könnte den ganzen freien
          Markt kaufen.
        </p>
        <p>
          Der Filter ist dabei das eigentliche Werkzeug. Ohne ihn zählen hunderte
          Ergänzungsspieler mit, die nie jemand kauft — das Verhältnis sieht dann
          schlechter aus, als es ist.
        </p>
      </Hinweis>

      <div className="kb-sortleiste kb-sortleiste--immer">
        {SCHWELLEN.map((s) => (
          <Link
            key={s.wert}
            href={`/liga/markt?league=${leagueId}&min=${s.wert}`}
            className={`kb-sortchip${schwelle === s.wert ? " kb-sortchip--aktiv" : ""}`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <Freieliste
        spieler={gefiltert}
        konto={ich ? ich.konto : null}
        teamwert={meinTeamwert}
        ligaAufschlag={aufLiga.relativ}
      />
    </main>
  );
}
