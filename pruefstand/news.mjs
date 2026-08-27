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

console.log("\nsaubereMeldung (alles vom Modell wird geprüft):");
const erlaubt = new Set(["101", "202"]);
pruefe("normale Meldung",
  saubereMeldung({ id: "101", text: " Muskelverletzung. ", stimmung: "schlecht",
                   quellen: [{ name: "kicker", url: "https://kicker.de/x" }] }, erlaubt),
  { id: "101", text: "Muskelverletzung.", stimmung: "schlecht",
    quellen: [{ name: "kicker", url: "https://kicker.de/x" }] });

pruefe("unbekannte Spieler-ID wird verworfen",
  saubereMeldung({ id: "999", text: "x" }, erlaubt), null);
pruefe("erfundene Stimmung wird neutral",
  saubereMeldung({ id: "101", text: "x", stimmung: "grandios" }, erlaubt).stimmung, "neutral");
pruefe("nichts=true → leerer Text",
  saubereMeldung({ id: "202", nichts: true, text: "irgendwas" }, erlaubt),
  { id: "202", text: "", stimmung: "neutral", quellen: [] });
pruefe("leerer Text zählt als nichts",
  saubereMeldung({ id: "202", text: "   " }, erlaubt).text, "");
pruefe("javascript:-URL fliegt raus",
  saubereMeldung({ id: "101", text: "x", quellen: [{ name: "böse", url: "javascript:alert(1)" }] }, erlaubt).quellen,
  [{ name: "böse", url: null }]);
pruefe("Quelle ohne Name und ohne URL fliegt ganz raus",
  saubereMeldung({ id: "101", text: "x", quellen: [{}, { name: "kicker" }] }, erlaubt).quellen,
  [{ name: "kicker", url: null }]);
pruefe("höchstens vier Quellen",
  saubereMeldung({ id: "101", text: "x",
    quellen: Array.from({ length: 9 }, (_, i) => ({ name: `q${i}` })) }, erlaubt).quellen.length, 4);
pruefe("Text wird gedeckelt",
  saubereMeldung({ id: "101", text: "a".repeat(2000) }, erlaubt).text.length, 600);
pruefe("Zahl als ID wird zu Text",
  saubereMeldung({ id: 101, text: "x" }, erlaubt)?.id, "101");
pruefe("quellen kein Array",
  saubereMeldung({ id: "101", text: "x", quellen: "kicker" }, erlaubt).quellen, []);
pruefe("Müll-Eintrag", saubereMeldung(null, erlaubt), null);

console.log(fehler ? `\n${fehler} Fall/Fälle falsch` : "\nAlle Fälle richtig.");
process.exit(fehler ? 1 : 0);
