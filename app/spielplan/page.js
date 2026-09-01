import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { DiagnoseKopf, LigaFehlt, probiere, Rohdaten } from "../_diagnose/Endpunkte";
import { schluesselBaum } from "@/lib/aufstellung";

export const dynamic = "force-dynamic";

// Zwei Fragen, die für die Gegner-Auswertung beantwortet sein müssen:
//
// 1. **Der Spielplan.** Wer spielt an welchem Spieltag gegen wen, zu
//    Hause oder auswärts? Ohne das gibt es weder Historie noch die
//    nächsten fünf Gegner.
// 2. **Punkte je Spieltag.** Kickbase-Punkte einer Mannschaft in einem
//    einzelnen Spiel. `kader.punkte` ist die Saisonsumme und taugt dafür
//    nicht; `mdp` aus dem Live-Endpunkt hängt am Manager, nicht am Verein.
//
// Beides ist in diesem Projekt **nicht belegt**. Deshalb erst probieren,
// dann bauen — wie bei Marktwert-Historie, Aufstellung und Live-Punkten.
export default async function Spielplan({ searchParams }) {
  const { token } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) return <LigaFehlt titel="Spielplan und Spieltagspunkte" />;

  await verlangeLiga(leagueId, token);

  // Diese Seite probiert über ein Dutzend Endpunkte durch. Das kostet
  // Aufrufe, also erst auf Klick — dieselbe Regel wie bei /livepunkte.
  if (p.suchen !== "1") {
    return (
      <main className="kb-seite kb-seite--schmal">
        <DiagnoseKopf titel="Spielplan und Spieltagspunkte" leagueId={leagueId} />
        <section className="kb-karte">
          <p>
            Gesucht werden zwei Dinge, die für die Gegner-Auswertung fehlen: der
            <strong> Spielplan</strong> (wer spielt wann gegen wen) und die
            <strong> Punkte einer Mannschaft je Spieltag</strong>.
          </p>
          <p className="kb-leise">
            Rund <strong>16 Kickbase-Aufrufe</strong>. Läuft deshalb erst auf Klick.
          </p>
          <p>
            <Link href={`/spielplan?league=${leagueId}&suchen=1`} className="kb-btn">
              Suche starten
            </Link>
          </p>
        </section>
      </main>
    );
  }

  // Für die spielerbezogenen Kandidaten eine echte Spieler-ID besorgen.
  let pid = p.pid ?? null;
  let tid = p.tid ?? null;
  try {
    const tabelle = await kbFetch("/v4/competitions/1/table", token);
    const ersteListe = Object.values(tabelle ?? {}).find(Array.isArray) ?? [];
    tid = tid ?? String(ersteListe[0]?.tid ?? ersteListe[0]?.i ?? "");
    if (!pid && tid) {
      const profil = await kbFetch(`/v4/competitions/1/teams/${tid}/teamprofile`, token);
      const spieler = Object.values(profil ?? {}).find(Array.isArray) ?? [];
      pid = String(spieler[0]?.i ?? spieler[0]?.pi ?? "");
    }
  } catch { /* dann eben ohne – die Pfade ohne ID gehen trotzdem */ }

  const spielplanPfade = [
    "/v4/competitions/1/matches",
    "/v4/competitions/1/matchdays",
    "/v4/competitions/1/matchday",
    "/v4/competitions/1/schedule",
    "/v4/competitions/1/fixtures",
    "/v4/competitions/1/table",
    `/v4/leagues/${leagueId}/matches`,
    `/v4/leagues/${leagueId}/matchdays`,
    ...(tid ? [
      `/v4/competitions/1/teams/${tid}/matches`,
      `/v4/competitions/1/teams/${tid}/teamcenter`,
    ] : []),
  ];

  const punktePfade = pid ? [
    `/v4/competitions/1/players/${pid}/performance`,
    `/v4/leagues/${leagueId}/players/${pid}/performance`,
    `/v4/leagues/${leagueId}/players/${pid}/stats`,
    `/v4/competitions/1/players/${pid}`,
    `/v4/leagues/${leagueId}/players/${pid}`,
  ] : [];

  const [plan, punkte] = await Promise.all([
    probiere(spielplanPfade, token),
    probiere(punktePfade, token),
  ]);

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Spielplan und Spieltagspunkte"
        unter={`Verein ${tid ?? "?"} · Spieler ${pid ?? "?"} · ${
          [...plan, ...punkte].filter((r) => r.ok).length} von ${plan.length + punkte.length} antworten`}
        leagueId={leagueId}
      />

      <Gruppe
        titel="1 · Spielplan: wer spielt wann gegen wen"
        erklaerung="Gesucht ist eine Liste mit Spieltag, zwei Mannschaften und – für die Historie – dem Ergebnis. Ohne Heim/Auswärts fehlt der Heimvorteil."
        ergebnisse={plan}
      />

      <Gruppe
        titel="2 · Punkte je Spieltag"
        erklaerung="Gesucht ist eine Reihe je Spieltag mit den Punkten dieses einen Spiels. Die Summe über alle Spieler eines Vereins ergibt dann die Mannschaftspunkte."
        ergebnisse={punkte}
      />
    </main>
  );
}

function Gruppe({ titel, erklaerung, ergebnisse }) {
  return (
    <section className="kb-karte">
      <h2 className="kb-abschnitt-titel">{titel}</h2>
      <p className="kb-info">{erklaerung}</p>
      {ergebnisse.length === 0 && <p className="kb-leise">Keine Kandidaten (fehlende ID).</p>}
      {ergebnisse.map((r) => (
        <div key={r.pfad}>
          <h3 className="kb-pfad">
            <span className={r.ok ? "kb-marke--exakt" : "kb-minus"}>{r.ok ? "OK" : r.fehler}</span>{" "}
            {r.pfad}
          </h3>
          {r.ok && (
            <>
              {/* Der Aufbau zuerst: Daran sieht man in einer Zeile, ob
                  überhaupt etwas Passendes drinsteht. */}
              <pre className="kb-roh">
                {schluesselBaum(r.daten).slice(0, 40)
                  .map((z) => `${z.pfad} = ${z.wert}`).join("\n")}
              </pre>
              <Rohdaten daten={r.daten} />
            </>
          )}
        </div>
      ))}
    </section>
  );
}
