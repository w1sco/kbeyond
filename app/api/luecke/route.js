import { pruefeApi, sitzung } from "@/lib/auth";
import { initSchema, merkeLuecke, verdaechtigeStille, getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

// Einen verdächtig stillen Zeitraum als Feed-Lücke übernehmen. Danach holt
// „Alles aktualisieren“ über die Spielerhistorie die Transfers daraus nach.
//
// **Nur ein Zeitraum, den die Seite selbst als still erkannt hat.** Ein
// beliebiges Fenster aus dem Formular könnte Feed-Events enthalten — dann
// legte die Historie dieselben Transfers ein zweites Mal ab.
export async function POST(request) {
  const { token, nutzer } = await sitzung();
  const leagueId = new URL(request.url).searchParams.get("league");
  const abgelehnt = await pruefeApi(request, leagueId, token, "/liga");
  if (abgelehnt) return abgelehnt;

  await initSchema();
  const form = await request.formData();
  const von = new Date(String(form.get("von") ?? ""));
  const bis = new Date(String(form.get("bis") ?? ""));

  const settings = await getSettings(leagueId, nutzer);
  const verdacht = await verdaechtigeStille(leagueId, settings.stichtag);
  const treffer = verdacht.find((v) =>
    v.von.getTime() === von.getTime() && v.bis.getTime() === bis.getTime());
  // 303, nicht 307: Nach einem Formular soll der Browser die Ligaseite
  // holen, nicht noch einmal etwas abschicken.
  const zurueck = (feld, text) => Response.redirect(new URL(
    `/liga?league=${encodeURIComponent(leagueId)}&${feld}=${encodeURIComponent(text)}`, request.url), 303);
  if (!treffer) return zurueck("fehler", "Dieser Zeitraum ist nicht (mehr) als still erkannt");

  await merkeLuecke(leagueId, treffer.von.toISOString(), treffer.bis.toISOString(), "Verdacht bestätigt");
  return zurueck("rekon",
    "Lücke übernommen — „Alles aktualisieren“ holt die Transfers daraus über die Spielerhistorie nach (mehrere Klicks)");
}
