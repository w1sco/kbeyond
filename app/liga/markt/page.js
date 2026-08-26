import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { initSchema, getSettings, getKader, getTeamwerte, sql } from "@/lib/db";
import { berechneKonten } from "@/lib/ledger";
import { holePoolGecached } from "@/lib/rekonstruktion";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { euro, prozent, zeitpunkt } from "@/lib/format";
import Freieliste from "./Freieliste";

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
];

export default async function Markt({ searchParams }) {
  const { token } = await sitzung();

  const p = await searchParams;
  if (!p.league) redirect("/liga");
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);

  await initSchema();

  const settings = await getSettings(leagueId);
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
  const manager = (ranking.us ?? []).filter((m) => m.adm !== true);

  const konten = await berechneKonten(leagueId, manager, settings, null);
  const tw = await getTeamwerte(leagueId);
  const kader = await getKader(leagueId);
  const pool = await holePoolGecached(token);

  // Kaufkraft der Liga: Kontostände plus das erlaubte Minus (Teamwert ÷ 3)
  const summeKonten = konten.reduce((s, k) => s + k.konto, 0);
  const summeLimit = konten.reduce((s, k) => {
    const t = tw.map.get(String(k.id));
    return s + Math.floor((t?.teamwert ?? 0) / 3);
  }, 0);

  // Frei = im Bundesliga-Pool, aber in keinem Kader der Liga
  const frei = pool.spieler
    .filter((s) => !kader.besetzt.has(String(s.id)))
    .map((s) => ({ ...s, marktwert: s.marktwert == null ? null : Number(s.marktwert) }));

  const ohneWert = frei.filter((s) => s.marktwert == null).length;
  const schwelle = Number(p.min ?? 0);
  const gefiltert = frei.filter((s) => (s.marktwert ?? 0) >= schwelle);
  const summeFrei = gefiltert.reduce((s, x) => s + (x.marktwert ?? 0), 0);

  const kaderLeer = kader.zeilen.length === 0;
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
          <form action={`/api/kader?league=${leagueId}&zurueck=1`} method="post">
            <button type="submit" className="kb-btn">Kader laden</button>
          </form>
        </div>
      </header>

      {kaderLeer && (
        <div className="kb-hinweis kb-hinweis--warn">
          Es sind noch keine Kader gespeichert — deshalb gilt hier gerade{" "}
          <strong>jeder</strong> Spieler als frei. Klick auf „Kader laden“, dann stimmt die
          Rechnung.
        </div>
      )}

      {ohneWert > 0 && (
        <div className="kb-hinweis kb-hinweis--warn">
          Für {ohneWert} der {frei.length} freien Spieler liefert Kickbase im Vereinskader
          keinen Marktwert. Die zählen unten als 0 € und fehlen damit in der Summe.
        </div>
      )}

      <div className="kb-status">
        <div>
          <span className="kb-label">Freie Spieler</span>
          <strong>{gefiltert.length}</strong>
          <span className="kb-leise"> von {frei.length}</span>
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

      <div className="kb-hinweis kb-hinweis--info">
        <strong>Verhältnis</strong> = Kontostände aller Manager ÷ Marktwert der freien Spieler
        im gewählten Bereich. Über 100 % heißt: die Liga könnte den ganzen freien Markt
        kaufen. Der Filter ist dabei das eigentliche Werkzeug — ohne ihn zählen hunderte
        Ergänzungsspieler mit, die nie jemand kauft.
      </div>

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
