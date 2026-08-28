import { sql, getAktiveManager, getSettings } from "./db";
import { nurMitspieler, adminModus } from "./manager";

// Die Mitspieler einer Liga — eine Stelle für alle Seiten.
//
// Die Regel selbst steht in `lib/manager.js` und ist reine Rechnung. Was
// sie braucht, kommt aber aus der Datenbank: wer einen Kader hat, wer
// gehandelt hat, und wie der Nutzer den Liga-Admin behandelt sehen will.
//
// **Warum das eine Funktion sein muss:** Die Ligaseite und der
// Aktualisieren-Lauf haben diese Daten schon einmal selbst
// zusammengesucht, die übrigen sieben Aufrufstellen nicht. Ergebnis: Ein
// mitspielender Admin stand in der Tabelle, aber seine Managerseite
// meldete „Manager nicht gefunden". Eine Liste, ein Weg.
export async function holeMitspieler(leagueId, ranking, settings = null) {
  const [kaderZeilen, gehandelt, einst] = await Promise.all([
    sql`SELECT DISTINCT manager_id FROM kader WHERE league_id = ${leagueId}`,
    getAktiveManager(leagueId),
    settings ? Promise.resolve(settings) : getSettings(leagueId),
  ]);

  return nurMitspieler(
    ranking?.us,
    { ids: new Set(kaderZeilen.map((z) => String(z.manager_id))), namen: gehandelt },
    adminModus(einst?.admin_zeigen)
  );
}
