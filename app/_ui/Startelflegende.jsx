import Hinweis from "./Hinweis";
import Startelfholen from "./Startelfholen";
import { STUFEN } from "@/lib/startelf";

// Was die fünf Zeichen bedeuten, woher sie kommen und wie weit der Abruf
// ist. Steht als Anreißer im Fluss, der ganze Text kommt auf Klick.
export default function Startelflegende({ stand = null, leagueId = null }) {
  return (
    <>
      <Hinweis kurz="Was die Zeichen vor den Namen bedeuten" titel="Startelf-Chance">
        <p>
          Wie sicher steht ein Spieler am <strong>kommenden Spieltag</strong> in der
          Startelf? Die Einschätzung kommt von <strong>Ligainsider</strong> und wird von
          Kickbase mitgeliefert — sie ist eine Prognose, keine Aufstellung.
        </p>
        <ul>
          {STUFEN.map((s) => (
            <li key={s.wert}>
              <span className={s.klasse}><strong>{s.zeichen}</strong></span> — {s.name}
            </li>
          ))}
        </ul>
        <p>
          <strong>Kein Zeichen heißt: keine Angabe</strong>, nicht „spielt nicht&ldquo;.
        </p>
        <p>
          Die meisten Spieler kommen umsonst mit: Vereinskader, eigene Kader und
          Marktangebote werden ohnehin geholt, und wenn Kickbase die Angabe dort
          mitführt, kostet sie keinen zusätzlichen Aufruf. Für den Rest gibt es den
          Knopf — er läuft in einem Rutsch durch.
        </p>
      </Hinweis>
      {leagueId && <Startelfholen leagueId={leagueId} stand={stand} />}
    </>
  );
}
