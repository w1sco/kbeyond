import { initSchema, merkeNews } from "@/lib/db";
import { pruefeApi, sitzung } from "@/lib/auth";
import { holeNews, BUENDEL } from "@/lib/news";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ein Bündel je Aufruf.
//
// Die Web-Recherche dauert pro Bündel gut eine halbe Minute — mehrere
// hintereinander liefen in Vercels 60-Sekunden-Grenze. Der Browser ruft
// deshalb wiederholt auf und zeigt den Fortschritt. Das hat nebenbei den
// Vorteil, dass ein Abbruch nur das laufende Bündel kostet: Alles davor
// steht schon in der Datenbank.
export async function POST(request) {
  const { token } = await sitzung();
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("league");

  const abgelehnt = await pruefeApi(request, leagueId, token);
  if (abgelehnt) return abgelehnt;

  let koerper;
  try {
    koerper = await request.json();
  } catch {
    return Response.json({ fehler: "Ungültige Anfrage" }, { status: 400 });
  }

  const { schluessel, modell, spieler } = koerper ?? {};
  if (!schluessel) {
    return Response.json({ fehler: "Kein API-Schlüssel übergeben" }, { status: 400 });
  }
  if (!Array.isArray(spieler) || spieler.length === 0) {
    return Response.json({ fehler: "Keine Spieler übergeben" }, { status: 400 });
  }

  // Der Browser bestimmt die Bündelgröße nicht selbst – sonst käme bei
  // einem Fehler in der Oberfläche eine Anfrage über 200 Spieler heraus.
  const buendel = spieler.slice(0, BUENDEL).map((s) => ({
    id: String(s.id ?? ""),
    name: String(s.name ?? "").slice(0, 80),
    verein: s.verein ? String(s.verein).slice(0, 60) : null,
  })).filter((s) => s.id && s.name);

  if (buendel.length === 0) {
    return Response.json({ fehler: "Keine auswertbaren Spieler" }, { status: 400 });
  }

  try {
    await initSchema();
    const meldungen = await holeNews({ schluessel, modell, spieler: buendel });

    // Auch Spieler ohne Fund bekommen einen Eintrag. Sonst würden sie bei
    // jedem Lauf erneut abgefragt, obwohl die Antwort feststeht.
    const nachId = new Map(meldungen.map((m) => [m.id, m]));
    const alle = buendel.map((s) => ({
      id: s.id,
      name: s.name,
      text: nachId.get(s.id)?.text ?? "",
      stimmung: nachId.get(s.id)?.stimmung ?? "neutral",
      quellen: nachId.get(s.id)?.quellen ?? [],
    }));

    await merkeNews(leagueId, alle);
    return Response.json({
      gespeichert: alle.length,
      mitMeldung: alle.filter((m) => m.text).length,
    });
  } catch (e) {
    // Der Schlüssel gehört dem Nutzer – die Meldung des Anbieters ist für
    // ihn die einzige Handhabe ("Guthaben leer", "Schlüssel ungültig").
    const status = typeof e?.status === "number" && e.status >= 400 && e.status < 500 ? 400 : 502;
    return Response.json({ fehler: e?.message ?? "Recherche fehlgeschlagen" }, { status });
  }
}
