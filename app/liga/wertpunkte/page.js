import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getTeamwerte, getTagesverlauf } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { geheimeZugaenge } from "@/lib/zugang";
import { wenVerbergen, verbergeKonten, verbergeTagesstand } from "@/lib/privatsphaere";
import { holeMitspieler } from "@/lib/mitspieler";
import { werteAus, pfade } from "@/lib/wertpunkte";
import { zeitpunkt, fuerTag } from "@/lib/format";
import Hinweis from "../../_ui/Hinweis";
import Ansicht from "./Ansicht";

export const dynamic = "force-dynamic";

// Wie steht der Gesamtwert eines Managers zu seinen Punkten?
//
// Gesamtwert = Teamwert + Kontostand, Punkte = Kickbase-Saisonpunkte.
// Heute als Punktwolke mit der Geraden der Liga, über die Saison als Weg
// je Manager, dazu eine Tabelle. Alles aus der Datenbank und der Rangliste —
// kein Kickbase-Aufruf über die Seiten-Stammdaten hinaus.
export default async function WertPunkte({ searchParams }) {
  const { token, nutzer, uid: meineUid, name: meinName } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) {
    return (
      <main className="kb-seite">
        <p className="kb-info">Liga fehlt. <Link prefetch={false} href="/liga">Zur Ligaauswahl</Link></p>
      </main>
    );
  }
  await verlangeLiga(leagueId, token);
  await initSchema();

  const settings = await getSettings(leagueId, nutzer);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const spieler = await holeMitspieler(leagueId, ranking, settings);
  const tw = await getTeamwerte(leagueId);

  const meineId = spieler.find(
    (m) => (meineUid && String(m.i) === meineUid) || (meinName && m.n === meinName))?.i ?? null;

  // Wer seine Finanzzahlen verbirgt, hat keinen Gesamtwert: Teamwert ist
  // sichtbar, Gesamtwert minus Teamwert wäre das Konto. Geschnitten wird
  // hier, bevor irgendetwas in den Browser geht.
  const geheim = wenVerbergen({ zugaenge: await geheimeZugaenge(), spieler, betrachterId: meineId });
  const konten = verbergeKonten(await berechneKonten(leagueId, spieler, settings), geheim);

  const { zeilen, trend, gezaehlt } = werteAus(konten.map((k) => {
    // Teamwert aus dem letzten Laden; ohne ihn keiner — eine 0 sähe aus
    // wie ein leerer Kader und drückte den Manager unter die Gerade.
    const teamwert = tw.map.get(String(k.id))?.teamwert ?? (k.teamwert > 0 ? k.teamwert : null);
    return {
      id: k.id,
      name: k.name,
      punkte: k.punkte,
      geheim: Boolean(k.finanzenGeheim),
      gesamt: k.finanzenGeheim || k.konto == null || teamwert == null ? null : teamwert + k.konto,
    };
  }));

  const tage = verbergeTagesstand(await getTagesverlauf(leagueId), geheim)
    .map((z) => ({ ...z, tag: fuerTag(z.tag) }));
  const wege = Object.fromEntries(pfade(tage));

  // Farben nach ID, wie im Verlauf auf der Ligaseite.
  const manager = [...spieler]
    .sort((a, b) => String(a.i).localeCompare(String(b.i), "de", { numeric: true }))
    .map((m) => ({ id: m.i, name: m.n }));

  const verborgen = zeilen.filter((z) => z.geheim).length;
  const ohneWert = zeilen.filter((z) => !z.geheim && z.gesamt == null).length;

  return (
    <main className="kb-seite kb-seite--schmal">
      <header className="kb-kopf">
        <div>
          <Link prefetch={false} href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Wert &amp; Punkte</h1>
          <p className="kb-unter">
            Gesamtwert (Teamwert + Kontostand) gegen Saisonpunkte ·
            {tw.stand ? ` Teamwerte vom ${zeitpunkt(tw.stand)}` : " noch keine Teamwerte geladen"}
          </p>
        </div>
      </header>

      <Hinweis kurz="Wie die Zahlen entstehen" titel="Wert und Punkte">
        <p>
          <strong>Gesamtwert</strong> ist Teamwert plus berechneter Kontostand — das ganze
          Vermögen eines Managers. <strong>Punkte</strong> sind seine Kickbase-Saisonpunkte,
          wie die Rangliste sie gerade führt.
        </p>
        <p>
          <strong>€ je Punkt</strong> teilt beides. Früh in der Saison ist die Zahl für alle
          groß, weil jeder mit demselben Budget anfängt und noch wenige Punkte hat.
        </p>
        <p>
          <strong>Die Gerade</strong> legt die Liga durch alle Manager (kleinste Quadrate):
          welcher Gesamtwert zu wie vielen Punkten passt. Ihr Achsenabschnitt fängt das
          gemeinsame Startbudget ab. <strong>„zur Geraden“</strong> ist der Abstand dazu —
          positiv heißt mehr Vermögen, als die Punkte erwarten lassen, negativ heißt mehr
          Punkte aus weniger Vermögen. Die Zahl sagt nichts darüber, wer besser spielt,
          nur, wie Wert und Punkte zueinander stehen.
        </p>
        <p>
          <strong>Der Saisonverlauf</strong> zeigt je Tag einen Punkt, an dem Punkte und
          Gesamtwert zugleich bekannt sind. Punkte stehen an Tagen, an denen aktualisiert
          wurde, und an Tagen ohne Spiel dazwischen; sonst fehlt der Tag.
        </p>
        <p>
          Wer seine Finanzzahlen verbirgt, steht ohne Gesamtwert in der Tabelle und fehlt in
          beiden Diagrammen und in der Geraden — aus Gesamtwert minus Teamwert ergäbe sich
          sein Kontostand.
        </p>
      </Hinweis>

      {(verborgen > 0 || ohneWert > 0) && (
        <p className="kb-info">
          {verborgen > 0 && <>{verborgen} Manager {verborgen === 1 ? "zeigt" : "zeigen"} {" "}
            {verborgen === 1 ? "seine" : "ihre"} Zahlen nicht und {verborgen === 1 ? "fehlt" : "fehlen"} in
            Diagrammen und Gerade. </>}
          {ohneWert > 0 && <>{ohneWert} ohne geladenen Teamwert — einmal aktualisieren. </>}
          Die Gerade steht auf {gezaehlt} Managern.
        </p>
      )}

      <Ansicht zeilen={zeilen} trend={trend} pfade={wege} meineId={meineId} manager={manager} />
    </main>
  );
}
