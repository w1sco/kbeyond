import Hinweis from "./Hinweis";
import { STUFEN } from "@/lib/startelf";

// Was die fünf Zeichen bedeuten, woher sie kommen und wie weit der Abruf
// ist. Steht als Anreißer im Fluss, der ganze Text kommt auf Klick.
export default function Startelflegende({ stand = null }) {
  return (
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
        <strong>Kein Zeichen heißt: keine Angabe</strong>, nicht „spielt nicht&ldquo;. Die
        Angabe kostet einen Kickbase-Aufruf je Spieler und wird deshalb in Häppchen
        geholt — wer in einem Kader steht oder am Markt liegt, zuerst.
        {stand?.tag != null && (
          <> Für Spieltag {stand.tag} sind <strong>{stand.geprueft}</strong> Spieler
          abgefragt, davon {stand.mitAngabe} mit Angabe.</>
        )}
      </p>
    </Hinweis>
  );
}
