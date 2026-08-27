import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { DiagnoseKopf, LigaFehlt, probiere, Ergebnisse } from "../_diagnose/Endpunkte";

export const dynamic = "force-dynamic";

// Prüft die Endpunkte, die ein anderes Werkzeug (Ligamonitor) laut eigener
// Beschreibung benutzt und die wir bisher nicht kennen oder als nicht
// vorhanden notiert haben.
//
// Vier Fragen auf einmal:
//
// 1. Gibt es eine **Transferhistorie je Manager**? In AGENTS.md steht
//    `/managers/{uid}/transfers` als 404 — wenn der Pfad nur anders lautet,
//    entfällt bei uns die 670er-Grenze samt Rekonstruktion.
// 2. Gibt es einen Endpunkt für die **echte Aufstellung**? Wir raten sie
//    derzeit aus dem Kader.
// 3. Gibt es die **Marktwertkurve** eines Spielers? Unsere Suche danach hat
//    aufgegeben.
// 4. Liefert das **Spielerprofil** eine Startelf-Wahrscheinlichkeit (`prob`)?
export default async function Ligamonitor({ searchParams }) {
  const { token, uid: meineUid } = await sitzung();
  const p = await searchParams;
  const leagueId = p.league;
  if (!leagueId) return <LigaFehlt titel="Endpunkte aus dem Vergleich" />;

  await verlangeLiga(leagueId, token);

  // Für wen probieren? Ohne Angabe der eigene Nutzer und ein Spieler aus
  // dem eigenen Kader — die gibt es garantiert.
  let uid = p.uid ?? meineUid ?? null;
  let pid = p.pid ?? null;
  let woher = "aus der Adresse";

  if (!uid || !pid) {
    try {
      const rang = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);
      uid = uid ?? String((rang.us ?? [])[0]?.i ?? "");
      woher = "erster Manager der Rangliste";
      if (!pid && uid) {
        const kader = await kbFetch(`/v4/leagues/${leagueId}/managers/${uid}/squad`, token);
        const erster = (kader.it ?? kader.pl ?? kader.players ?? [])[0];
        pid = pid ?? String(erster?.i ?? erster?.id ?? "");
      }
    } catch {
      // Dann eben ohne – die Pfade, die keine ID brauchen, gehen trotzdem
    }
  }

  const gruppen = [];

  if (uid) {
    gruppen.push({
      titel: "1 · Transferhistorie je Manager",
      erklaerung:
        "Wenn es das gibt, entfällt bei uns die 670er-Feedgrenze und die ganze " +
        "Rekonstruktion über Spieler-Historien. Achtung: Strafen und Login-Boni " +
        "stehen trotzdem nur im Feed — der bleibt in jedem Fall nötig.",
      pfade: [
        `/v4/leagues/${leagueId}/managers/${uid}/transfers`,
        `/v4/leagues/${leagueId}/managers/${uid}/transfers?start=0&max=25`,
        `/v4/leagues/${leagueId}/managers/${uid}/transferhistory`,
        `/v4/leagues/${leagueId}/managers/${uid}/transferHistory`,
        `/v4/leagues/${leagueId}/managers/${uid}/history`,
        `/v4/leagues/${leagueId}/managers/${uid}/activities`,
        `/v4/leagues/${leagueId}/managers/${uid}/performance`,
      ],
    });

    gruppen.push({
      titel: "2 · Echte Aufstellung",
      erklaerung:
        "Wir raten die Startelf derzeit aus dem Kader — gesucht wird das Feld, " +
        "bei dem genau elf Spieler markiert sind. Ein eigener Endpunkt wäre besser.",
      pfade: [
        `/v4/leagues/${leagueId}/lineup`,
        `/v4/leagues/${leagueId}/managers/${uid}/lineup`,
        `/v4/leagues/${leagueId}/lineup/${uid}`,
        `/v4/leagues/${leagueId}/managers/${uid}/teamcenter`,
      ],
    });
  }

  if (pid) {
    gruppen.push({
      titel: "3 · Marktwertkurve eines Spielers",
      erklaerung:
        "Trägt bei uns die Aufschlags-Rechnung. Unsere Suche nach diesem " +
        "Endpunkt hat aufgegeben; laut Vergleich gibt es ihn mit 365 Tagen.",
      pfade: [
        `/v4/leagues/${leagueId}/players/${pid}/marketvalue/365`,
        `/v4/leagues/${leagueId}/players/${pid}/marketvalue`,
        `/v4/leagues/${leagueId}/players/${pid}/marketValueHistory`,
        `/v4/competitions/1/players/${pid}/marketvalue/365`,
        `/v4/competitions/1/players/${pid}/marketvalue`,
      ],
    });

    gruppen.push({
      titel: "4 · Spielerprofil mit Startelf-Wahrscheinlichkeit",
      erklaerung:
        "Gesucht ist ein Feld `prob` mit Werten 1–5 (sicher bis spielt nicht). " +
        "Kennen wir bisher gar nicht.",
      pfade: [
        `/v4/competitions/1/players/${pid}`,
        `/v4/leagues/${leagueId}/players/${pid}`,
        `/v4/competitions/1/players/${pid}/performance`,
      ],
    });
  }

  const ergebnisse = [];
  for (const g of gruppen) {
    ergebnisse.push({ gruppe: g, treffer: await probiere(g.pfade, token) });
  }

  const gefunden = ergebnisse.filter((e) => e.treffer.some((t) => t.ok));

  return (
    <main className="kb-seite">
      <DiagnoseKopf
        titel="Endpunkte aus dem Vergleich"
        unter={`Manager ${uid || "–"} (${woher}) · Spieler ${pid || "–"}`}
        leagueId={leagueId}
      />

      <div className={`kb-hinweis ${gefunden.length ? "kb-hinweis--gut" : "kb-hinweis--warn"}`}>
        {gefunden.length} von {ergebnisse.length} Fragen beantwortet.{" "}
        {gefunden.length === 0
          ? "Kein Kandidat hat geantwortet — dann stimmt unsere bisherige Annahme."
          : "Was hier mit OK steht, können wir übernehmen."}
      </div>

      <p className="kb-info">
        Andere IDs prüfen: <code>?league={leagueId}&uid=…&pid=…</code> ·{" "}
        <Link href={`/liga?league=${leagueId}`}>zurück</Link>
      </p>

      {ergebnisse.map((e) => (
        <section key={e.gruppe.titel} style={{ marginTop: 18 }}>
          <h2 className="kb-abschnitt-titel">{e.gruppe.titel}</h2>
          <p className="kb-info">{e.gruppe.erklaerung}</p>
          <Ergebnisse ergebnisse={e.treffer} />
        </section>
      ))}
    </main>
  );
}
