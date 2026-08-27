// Was das Modell antwortet, ist Text – kein Versprechen. Der Parser muss
// mit allem umgehen, was dabei herauskommen kann.
import { findeArray, saubereMeldung } from "../lib/news.js";

let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`      ist:  ${JSON.stringify(ist)}\n      soll: ${JSON.stringify(soll)}`);
};

console.log("findeArray:");
pruefe("nacktes Array", findeArray('[{"id":"1"}]'), [{ id: "1" }]);
pruefe("in ```json verpackt", findeArray('```json\n[{"id":"1"}]\n```'), [{ id: "1" }]);
pruefe("in ``` ohne Sprache", findeArray('```\n[{"id":"2"}]\n```'), [{ id: "2" }]);
pruefe("Geschwätz davor und danach", findeArray('Hier bitte:\n[{"id":"3"}]\nViel Erfolg!'), [{ id: "3" }]);
pruefe("leeres Array", findeArray("[]"), []);
pruefe("kaputtes JSON", findeArray('[{"id": }]'), null);
pruefe("Objekt statt Array", findeArray('{"id":"1"}'), null);
pruefe("gar kein JSON", findeArray("Ich konnte nichts finden."), null);
pruefe("leer", findeArray(""), null);
pruefe("null", findeArray(null), null);
pruefe("Klammer im Text vor dem Array",
  findeArray('Quellen [1] und [2] sagen:\n[{"id":"4"}]'), [{ id: "4" }]);

console.log("\nsaubereMeldung (Zuordnung über die Nummer, nicht die Kickbase-ID):");
const nachNummer = new Map([[1, { id: "101", name: "Tah" }], [2, { id: "202", name: "Neuer" }]]);
pruefe("normale Meldung",
  saubereMeldung({ nr: 1, text: " Muskelverletzung. ", stimmung: "schlecht",
                   quellen: [{ name: "kicker", url: "https://kicker.de/x" }] }, nachNummer),
  { id: "101", text: "Muskelverletzung.", stimmung: "schlecht",
    quellen: [{ name: "kicker", url: "https://kicker.de/x" }] });

pruefe("Nummer als Text", saubereMeldung({ nr: "2", text: "x" }, nachNummer)?.id, "202");
pruefe("unbekannte Nummer wird verworfen", saubereMeldung({ nr: 99, text: "x" }, nachNummer), null);
pruefe("Nummer 0 wird verworfen", saubereMeldung({ nr: 0, text: "x" }, nachNummer), null);
pruefe("keine Nummer", saubereMeldung({ text: "x" }, nachNummer), null);
pruefe("alte Form mit id greift noch", saubereMeldung({ id: 1, text: "x" }, nachNummer)?.id, "101");
pruefe("erfundene Stimmung wird neutral",
  saubereMeldung({ nr: 1, text: "x", stimmung: "grandios" }, nachNummer).stimmung, "neutral");
pruefe("nichts=true → leerer Text",
  saubereMeldung({ nr: 2, nichts: true, text: "irgendwas" }, nachNummer),
  { id: "202", text: "", stimmung: "neutral", quellen: [] });
pruefe("leerer Text zählt als nichts",
  saubereMeldung({ nr: 2, text: "   " }, nachNummer).text, "");
pruefe("javascript:-URL fliegt raus",
  saubereMeldung({ nr: 1, text: "x", quellen: [{ name: "böse", url: "javascript:alert(1)" }] }, nachNummer).quellen,
  [{ name: "böse", url: null }]);
pruefe("Quelle ohne Name und ohne URL fliegt ganz raus",
  saubereMeldung({ nr: 1, text: "x", quellen: [{}, { name: "kicker" }] }, nachNummer).quellen,
  [{ name: "kicker", url: null }]);
pruefe("höchstens vier Quellen",
  saubereMeldung({ nr: 1, text: "x",
    quellen: Array.from({ length: 9 }, (_, i) => ({ name: `q${i}` })) }, nachNummer).quellen.length, 4);
pruefe("Text wird gedeckelt",
  saubereMeldung({ nr: 1, text: "a".repeat(2000) }, nachNummer).text.length, 600);
pruefe("quellen kein Array",
  saubereMeldung({ nr: 1, text: "x", quellen: "kicker" }, nachNummer).quellen, []);
pruefe("Müll-Eintrag", saubereMeldung(null, nachNummer), null);

console.log(fehler ? `\n${fehler} Fall/Fälle falsch` : "\nAlle Fälle richtig.");
process.exit(fehler ? 1 : 0);
