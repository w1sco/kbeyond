import { initSchema, merkeNews } from "@/lib/db";
import { pruefeApi, sitzung } from "@/lib/auth";
import { holeNews, MODUS } from "@/lib/news";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ein Bündel je Aufruf.
//
// Der Browser ruft wiederholt auf und zeigt den Fortschritt. Ein Abbruch
// kostet damit nur das laufende Bündel — alles davor steht schon in der
// Datenbank.
//
// Zwei Modi: "sammeln" deckt zwölf Spieler über Übersichtsseiten ab und
// ist der Normalfall; "einzeln" ist die Tiefensuche für genau einen
// Spieler und läuft nur auf ausdrücklichen Klick. Welcher gilt, entscheidet
// die Route selbst — der Browser darf sich keinen teureren aussuchen, als
// hier vorgesehen ist.
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

  const { schluessel, modell, spieler, modus: gewuenscht } = koerper ?? {};
  // Nur bekannte Modi – sonst bestimmte der Browser, wie teuer ein Lauf wird.
  const modus = gewuenscht === "einzeln" ? "einzeln" : "sammeln";
  if (!schluessel) {
    return Response.json({ fehler: "Kein API-Schlüssel übergeben" }, { status: 400 });
  }
  if (!Array.isArray(spieler) || spieler.length === 0) {
    return Response.json({ fehler: "Keine Spieler übergeben" }, { status: 400 });
  }

  // Der Browser bestimmt die Bündelgröße nicht selbst – sonst käme bei
  // einem Fehler in der Oberfläche eine Anfrage über 200 Spieler heraus.
  const buendel = spieler.slice(0, MODUS[modus].buendel).map((s) => ({
    id: String(s.id ?? ""),
    name: String(s.name ?? "").slice(0, 80),
    verein: s.verein ? String(s.verein).slice(0, 60) : null,
  })).filter((s) => s.id && s.name);

  if (buendel.length === 0) {
    return Response.json({ fehler: "Keine auswertbaren Spieler" }, { status: 400 });
  }

  try {
    await initSchema();
    const meldungen = await holeNews({ schluessel, modell, spieler: buendel, modus });

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
    // Der Schlüssel gehört dem Nutzer – er muss verstehen, was zu tun ist.
    // Die rohe Fehlermeldung des Anbieters ist dafür unbrauchbar: Sie
    // kommt als JSON-Klumpen und sagt einem Nichtentwickler nichts.
    const status = typeof e?.status === "number" ? e.status : 0;
    const text =
      status === 401 || status === 403
        ? "Der API-Schlüssel wird abgelehnt. Prüfe ihn unter „Frag die Liga“."
        : status === 429
          ? "Anthropic drosselt gerade — kurz warten und nochmal."
          : status === 400 && /credit|balance/i.test(e?.message ?? "")
            ? "Das Guthaben des Schlüssels reicht nicht."
            : (e?.message ?? "Recherche fehlgeschlagen").slice(0, 200);

    return Response.json({ fehler: text }, { status: status >= 400 && status < 500 ? 400 : 502 });
  }
}
