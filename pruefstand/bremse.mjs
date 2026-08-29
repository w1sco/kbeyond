// Die Drosselsperre muss ablaufen.
//
// Vorher war sie ein `boolean`, den nur die Aktualisieren-Route
// zurückgesetzt hat. Eine warme Serverless-Instanz, die einmal in eine
// Drosselung gelaufen war, hat danach **jede** weitere Anfrage sofort
// abgebrochen — die Ligaauswahl antwortete mit HTTP 500, obwohl Kickbase
// längst wieder lieferte.
import {
  kbFetch, istGedrosselt, bremseZuruecksetzen, sperreRestSekunden, GedrosseltFehler,
} from "../lib/kickbase.js";

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`FEHLER  ${name}\n  ist:  ${JSON.stringify(ist)}\n  soll: ${JSON.stringify(soll)}`); }
};

globalThis.fetch = async () =>
  new Response("{}", { status: 429, headers: { "Content-Type": "application/json" } });

bremseZuruecksetzen();
pruefe("am Anfang frei", istGedrosselt(), false);

// Letzter Versuch: sperrt sofort, ohne die Wartezeiten durchzulaufen.
let geworfen = null;
try {
  await kbFetch("/v4/irgendwas", "token", 3);
} catch (e) {
  geworfen = e;
}
pruefe("wirft GedrosseltFehler", geworfen instanceof GedrosseltFehler, true);
pruefe("Fehler ist als Drosselung erkennbar", geworfen?.gedrosselt, true);
pruefe("jetzt gesperrt", istGedrosselt(), true);

const rest = sperreRestSekunden();
pruefe("Sperre läuft ab (1–60 s)", rest > 0 && rest <= 60, true);

// Ein weiterer Aufruf bricht sofort ab – das ist der Sinn der Sperre.
let zweiter = null;
try {
  await kbFetch("/v4/anderes", "token");
} catch (e) {
  zweiter = e;
}
pruefe("weiterer Aufruf bricht ab", zweiter instanceof GedrosseltFehler, true);

// Und sie lässt sich von Hand lösen.
bremseZuruecksetzen();
pruefe("zurückgesetzt", istGedrosselt(), false);
pruefe("Rest dann 0", sperreRestSekunden(), 0);

// Retry-After wird übernommen, aber gedeckelt.
globalThis.fetch = async () =>
  new Response("{}", { status: 503, headers: { "retry-after": "120" } });
try { await kbFetch("/v4/x", "token", 3); } catch { /* erwartet */ }
pruefe("Retry-After übernommen", sperreRestSekunden() > 60, true);
pruefe("aber gedeckelt (≤ 5 min)", sperreRestSekunden() <= 300, true);

bremseZuruecksetzen();
console.log(`\n${ok} ok, ${fehler} Fehler`);
process.exit(fehler ? 1 : 0);
