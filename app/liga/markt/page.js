import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getKader, getBesitz, getTeamwerte, sql } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { holePoolGecached } from "@/lib/rekonstruktion";
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
  const { token, nutzer } = await sitzung();

  const p = await searchParams;
  if (!p.league) redirect("/liga");
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);

  await initSchema();

  const settings = await getSettings(leagueId, nutzer);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const manager = (ranking.us ?? []).filter((m) => m.adm !== true);

  const konten = await berechneKonten(leagueId, manager, settings, null);
  const tw = await getTeamwerte(leagueId);
  const kader = await getKader(leagueId);
  const besitz = await getBesitz(leagueId);
  const pool = await holePoolGecached(token);

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

  const frei = pool.spieler
    .filter((s) => !vergeben.has(String(s.id)))
    .map((s) => ({ ...s, marktwert: s.marktwert == null ? null : Number(s.marktwert) }));

  const ohneWert = frei.filter((s) => s.marktwert == null).length;
  const schwelle = Number(p.min ?? 0);
  const gefiltert = frei.filter((s) => (s.marktwert ?? 0) >= schwelle);
  const summeFrei = gefiltert.reduce((s, x) => s + (x.marktwert ?? 0), 0);

  const nurAusKader = [...kader.besetzt].filter((id) => !besitz.besitzer.has(id)).length;
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

      <Freieliste spieler={gefiltert} />
    </main>
  );
}
