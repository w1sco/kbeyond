import Link from "next/link";
import { cookies } from "next/headers";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getKader, getNews, getStartelf } from "@/lib/db";
import { sitzung, verlangeLiga, nutzerSchluessel } from "@/lib/auth";
import { normalisiereSpieler } from "@/lib/format";
import { holePool } from "@/lib/rekonstruktion";
import { TAGE_ZURUECK } from "@/lib/news";
import Newsliste from "./Newsliste";
import Hinweis from "../../_ui/Hinweis";

export const dynamic = "force-dynamic";

export default async function News({ searchParams }) {
  const { token, name: meinName, uid: meineUid } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;

  await verlangeLiga(leagueId, token);
  await initSchema();

  const store = await cookies();
  const nutzer = nutzerSchluessel(store);
  await getSettings(leagueId, nutzer);

  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const kader = await getKader(leagueId);
  const pool = await holePool();
  // Der Vereinsname, nicht die Team-ID: Für eine Nachrichtensuche ist
  // "(7)" schlimmer als gar keine Angabe.
  const vereine = new Map(pool.spieler.map((s) => [String(s.id), s.verein ?? null]));

  // Wer bin ich? Ohne Zuordnung gibt es keinen eigenen Kader – dann bleibt
  // die Marktliste, die ist für alle gleich.
  const ich = (ranking.us ?? []).find(
    (m) => (meineUid && String(m.i) === meineUid) || (meinName && m.n === meinName)
  ) ?? null;

  const meinKader = ich ? kader.proManager.get(String(ich.i)) ?? [] : [];

  // Der Transfermarkt ist flüchtig und steht nicht in der Datenbank –
  // ein Abruf, wie ihn die Transfermarktseite auch macht.
  let markt = [];
  try {
    const roh = await kbFetch(`/v4/leagues/${leagueId}/market`, token);
    markt = (roh.it ?? []).map((e) => normalisiereSpieler(e));
  } catch {
    // Der Markt ist Beiwerk – der eigene Kader soll trotzdem dastehen
  }

  const news = await getNews(leagueId);
  const elf = await getStartelf();

  const bauen = (liste) =>
    liste
      .map((s) => ({
        id: String(s.id),
        name: s.name ?? `Spieler #${s.id}`,
        marktwert: Number(s.marktwert ?? 0),
        position: s.position ?? null,
        startelf: elf.get(String(s.id)) ?? null,
        verein: vereine.get(String(s.id)) ?? null,
        meldung: news.get(String(s.id)) ?? null,
      }))
      .sort((a, b) => b.marktwert - a.marktwert);

  const gruppen = [
    { schluessel: "kader", titel: "Mein Kader", spieler: bauen(meinKader) },
    { schluessel: "markt", titel: "Aktuell am Transfermarkt", spieler: bauen(markt) },
  ];

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>News · {ranking.ti}</h1>
          <p className="kb-unter">
            Meldungen der letzten {TAGE_ZURUECK} Tage zu deinen Spielern und allen
            Angeboten am Markt.
          </p>
        </div>
      </header>

      {!ich && (
        <div className="kb-hinweis kb-hinweis--warn">
          Du bist keinem Manager zugeordnet — dein Kader fehlt deshalb. Das lässt sich
          auf der Ligaseite einmalig einstellen.
        </div>
      )}

      <Newsliste leagueId={leagueId} gruppen={JSON.parse(JSON.stringify(gruppen))} />

      <div style={{ marginTop: 14 }}>
        <Hinweis kurz="Woher die News kommen" titel="Quellen und Kosten">
          <p>
            Die Meldungen werden <strong>im Netz recherchiert</strong>: Claude sucht
            selbst und fasst zusammen. Kickbase liefert keine Nachrichten, und dieses
            Projekt hat keine eigene Redaktion.
          </p>
          <p>
            Die Suche ist <strong>nicht auf eine feste Quellenliste eingeengt</strong> —
            eine solche Liste schlösse genau die regionalen Quellen aus, die man vorher
            nicht aufzählen kann. Stattdessen sind kicker, ligainsider, Deichstube,
            DerWesten und Transfer-Journalisten wie Fabrizio Romano als bevorzugt
            benannt, und jede Meldung nennt ihre Herkunft. So ist am Ergebnis ablesbar,
            worauf es beruht.
          </p>
          <p>
            <strong>Du zahlst deine eigene Recherche.</strong> Es gilt derselbe
            API-Schlüssel wie bei „Frag die Liga“ — er liegt in deinem Browser und wird
            bei jedem Lauf mitgeschickt, einmal benutzt und nicht gespeichert. Der
            Server hat keinen eigenen Schlüssel.
          </p>
          <p>
            Gefunden wird in Bündeln zu wenigen Spielern. Ein Abbruch kostet deshalb
            nur das laufende Bündel — alles davor steht bereits in der Datenbank und
            bleibt beim nächsten Aufruf stehen.
          </p>
          <p>
            <strong>Was nicht gefunden wurde, bleibt leer.</strong> Ein Spieler ohne
            Meldung in den letzten {TAGE_ZURUECK} Tagen ist ein gültiges Ergebnis und
            keine Lücke — erfundene Meldungen wären hier deutlich schlimmer als gar
            keine.
          </p>
        </Hinweis>
      </div>
    </main>
  );
}
