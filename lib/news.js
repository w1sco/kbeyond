import Anthropic from "@anthropic-ai/sdk";

// Spielernachrichten der letzten 30 Tage.
//
// ── Woher die News kommen ───────────────────────────────────────────
//
// Kickbase liefert keine Nachrichten, und das Projekt hat keine eigene
// Redaktion. Geholt wird deshalb über die **Web-Suche des Modells**:
// Claude durchsucht das Netz selbst und fasst zusammen. Damit sind alle
// Quellen erreichbar — überregional (kicker, ligainsider), regional
// (Deichstube, DerWesten) und Transfer-Konten wie Fabrizio Romano.
//
// Die Suche wird bewusst NICHT auf eine Domainliste eingeengt: Eine feste
// Liste schlösse genau die regionalen Quellen aus, die man nicht vorher
// aufzählen kann. Stattdessen stehen die bevorzugten Quellen in der
// Anweisung, und jede Meldung muss ihre Herkunft nennen — so ist am
// Ergebnis ablesbar, worauf sie beruht.
//
// Der Schlüssel gehört dem Nutzer, wie bei "Frag die Liga". Der Server hat
// keinen eigenen.

export const TAGE_ZURUECK = 30;

// Die Websuche gibt es in zwei Fassungen; welche gilt, hängt am Modell.
const WERKZEUG_NEU = "web_search_20260209";
const WERKZEUG_ALT = "web_search_20250305";

// ── Zwei Modi, weil Recherche Geld kostet ───────────────────────────
//
// **sammeln** ist der Normalfall und bewusst billig: Ein Aufruf deckt ein
// ganzes Bündel Spieler ab, und gesucht wird auf **Übersichtsseiten** —
// die Ausfall- und Sperrenlisten von ligainsider, kicker und
// transfermarkt führen hunderte Spieler auf einmal. Eine Suche beantwortet
// damit die Frage für zwölf Spieler statt für einen.
//
// **einzeln** ist die Tiefensuche und läuft nur auf ausdrücklichen Klick
// für genau einen Spieler: mehr Suchen, breitere Quellen, mehr Text.
//
// Der erste Entwurf suchte für jeden Spieler einzeln und breit. Bei einem
// Kader plus Transfermarkt waren das 71 Recherchen für einen Knopfdruck —
// zu teuer und zu langsam (die Anfragen liefen in Vercels Zeitgrenze).
export const MODUS = {
  sammeln: {
    buendel: 12,
    // Fünf statt drei: Bei drei Suchen für zwölf Spieler antwortete das
    // Modell reihenweise mit "nichts gefunden", statt wirklich
    // nachzusehen. Fünf Suchen für zwölf Spieler sind immer noch ein
    // Bruchteil von zwölf Einzelrecherchen.
    suchen: 5,
    maxTokens: 4000,
    effort: "low",
  },
  einzeln: {
    buendel: 1,
    suchen: 6,
    maxTokens: 2000,
    effort: "medium",
  },
};

// Für die Oberfläche: so viele Spieler gehen in einen Sammelaufruf.
export const BUENDEL = MODUS.sammeln.buendel;

// Gemeinsamer Teil: was gefragt ist und wie geantwortet wird.
const FORM = `Schreibe kurz und knapp: höchstens drei Sätze, deutsch, ohne
Floskeln, ohne Einleitung, ohne Wiederholung des Namens.

Gibt es zu einem Spieler nichts aus den letzten ${TAGE_ZURUECK} Tagen, ist das
ein gültiges Ergebnis: "text" leer lassen und "nichts" auf true setzen.
Erfinde nichts und rate nicht — lieber nichts als eine erfundene Meldung.
Eine erfundene Verletzungsmeldung ist hier schädlicher als eine leere Zeile.

Antworte NUR mit einem JSON-Array, ohne Text davor oder danach, mit genau
einem Eintrag je genanntem Spieler:
[
  {
    "id": "<die mitgegebene Spieler-ID, unverändert>",
    "nichts": false,
    "text": "Ein bis drei Sätze.",
    "stimmung": "gut" | "schlecht" | "neutral",
    "quellen": [{ "name": "ligainsider", "url": "https://..." }]
  }
]
"stimmung" aus Sicht eines Managers, der den Spieler besitzt: "schlecht"
bei Verletzung, Sperre oder Bankdrohung, "gut" bei Rückkehr oder starker
Form, sonst "neutral".`;

// Sammelmodus: Übersichtsseiten statt Einzelsuchen.
//
// Die Ausfall- und Sperrenlisten der großen Portale führen hunderte
// Spieler auf einmal. Eine Suche darauf beantwortet die Frage für ein
// ganzes Bündel — genau darum ist dieser Modus billig.
const ANWEISUNG_SAMMELN = `Du recherchierst für ein Kickbase-Analysewerkzeug Neuigkeiten zu Bundesliga-Spielern der letzten ${TAGE_ZURUECK} Tage.

ARBEITE SPARSAM, ABER GRÜNDLICH: Suche nicht nach jedem Spieler einzeln.
Nutze **Sammel- und Übersichtsseiten**, die viele Spieler auf einmal
abdecken:
- die Verletzten- und Sperrenlisten von ligainsider, kicker und
  transfermarkt.de ("Ausfälle", "Verletzte und gesperrte Spieler")
- Verletzungs- und Kaderübersichten der betroffenen Vereine
- aktuelle Spieltagsvorschauen und voraussichtliche Aufstellungen

**Führe mindestens zwei, besser drei solcher Suchen durch, bevor du
antwortest.** Gleiche die Treffer dann gegen die Spielerliste ab — die
Listen führen Nachnamen, unsere Liste teils auch Vornamen.

Melde alles, was du zu einem Spieler findest: Verletzung, Sperre,
Ausfallzeit, Rückkehr ins Training, Startelf oder Bank, Formkurve,
Wechselgerüchte.

Gib für **JEDEN** genannten Spieler genau einen Eintrag zurück, auch wenn
du nichts gefunden hast. Übernimm die "id" **exakt** so, wie sie in der
Liste steht — daran wird zugeordnet.

${FORM}`;

// Einzelmodus: die Tiefensuche, nur auf ausdrücklichen Klick.
const ANWEISUNG_EINZELN = `Du recherchierst gründlich zu EINEM Bundesliga-Spieler für ein Kickbase-Analysewerkzeug.

Suche nach allem aus den letzten ${TAGE_ZURUECK} Tagen, was für einen
Kickbase-Manager zählt: Verletzung, Sperre, Ausfallzeit, Rückkehr ins
Training, Startelf oder Bank, Formkurve, Trainerurteil, Wechselgerüchte,
Vertragsverlängerung.

Nutze hier das ganze Spektrum der Quellen — überregionale (kicker,
ligainsider, Sky, Bild), Vereins- und Regionalmedien (Deichstube,
DerWesten, WAZ, Express, Mopo) und Transfer-Journalisten wie Fabrizio
Romano. Nenne zu jeder Meldung die Quelle.

${FORM}`;

// Das Modell soll ein JSON-Array liefern. Ob es das sauber tut, ist nicht
// garantiert — deshalb wird es herausgeschnitten statt blind geparst.
export function findeArray(text) {
  if (!text) return null;
  const roh = String(text);

  // Häufigster Fall: in einen Codeblock verpackt
  const block = roh.match(/```(?:json)?\s*([\s\S]*?)```/);
  const kandidaten = [block?.[1], roh];

  for (const k of kandidaten) {
    if (!k) continue;
    const ende = k.lastIndexOf("]");
    if (ende < 0) continue;

    // Jede öffnende Klammer als Anfang durchprobieren, nicht nur die erste.
    // Eine Klammer im Fließtext ("laut [1] und [2]") würde sonst den
    // Ausschnitt zerreißen und das Array unauffindbar machen.
    for (let a = k.indexOf("["); a >= 0 && a < ende; a = k.indexOf("[", a + 1)) {
      try {
        const daten = JSON.parse(k.slice(a, ende + 1));
        if (Array.isArray(daten)) return daten;
      } catch {
        // nächster Anfang
      }
    }
  }
  return null;
}

// Einen Eintrag auf das reduzieren, was wir wirklich speichern wollen.
// Alles kommt vom Modell und wird deshalb geprüft, nicht übernommen.
export function saubereMeldung(roh, erlaubteIds) {
  const id = String(roh?.id ?? "");
  if (!erlaubteIds.has(id)) return null;

  const text = typeof roh?.text === "string" ? roh.text.trim() : "";
  if (roh?.nichts === true || !text) return { id, text: "", stimmung: "neutral", quellen: [] };

  const stimmung = ["gut", "schlecht", "neutral"].includes(roh?.stimmung) ? roh.stimmung : "neutral";

  const quellen = Array.isArray(roh?.quellen)
    ? roh.quellen
        .map((q) => ({
          name: typeof q?.name === "string" ? q.name.slice(0, 60) : "",
          url: typeof q?.url === "string" && /^https?:\/\//.test(q.url) ? q.url : null,
        }))
        .filter((q) => q.name || q.url)
        .slice(0, 4)
    : [];

  return { id, text: text.slice(0, 600), stimmung, quellen };
}

// Ein Bündel Spieler, eine Anfrage.
export async function holeNews({ schluessel, modell, spieler, modus = "sammeln" }) {
  const einst = MODUS[modus] ?? MODUS.sammeln;
  const client = new Anthropic({ apiKey: schluessel });
  const liste = spieler
    .map((s) => `- id ${s.id}: ${s.name}${s.verein ? ` (${s.verein})` : ""}`)
    .join("\n");

  const anfrage = (werkzeug) => ({
    model: modell || "claude-opus-5",
    // Klein halten: Jede Sekunde zählt gegen die Zeitgrenze, und jeder
    // Token kostet den Nutzer Geld.
    max_tokens: einst.maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: einst.effort },
    tools: [
      {
        type: werkzeug,
        name: "web_search",
        // Gedeckelt, weil jede Suche Zeit und Geld kostet. Im Sammelmodus
        // reichen wenige Suchen auf Übersichtsseiten für das ganze Bündel.
        max_uses: einst.suchen,
      },
    ],
    system: modus === "einzeln" ? ANWEISUNG_EINZELN : ANWEISUNG_SAMMELN,
    messages: [
      {
        role: "user",
        content:
          `Heute ist ${new Date().toISOString().slice(0, 10)}.\n\n` +
          `Spieler:\n${liste}\n\n` +
          (modus === "einzeln"
            ? "Recherchiere gründlich und antworte nur mit dem JSON-Array."
            : "Nutze Übersichtsseiten statt Einzelsuchen. Antworte nur mit dem JSON-Array."),
      },
    ],
  });

  // Welche Fassung der Websuche ein Modell versteht, hängt vom Modell ab —
  // und der Nutzer wählt sein Modell selbst. Statt das zu raten, wird die
  // neuere zuerst versucht und bei einer Ablehnung die ältere genommen.
  // Nur bei 400: alles andere (Schlüssel ungültig, Guthaben leer) soll
  // durchschlagen statt ein zweites Mal Geld zu kosten.
  // Über den Strom, nicht als einzelner Aufruf: Eine Recherche kann Minuten
  // dauern, und ein stiller Aufruf läuft dabei in Zeitgrenzen — beim SDK
  // wie beim Netz davor.
  const laufen = async (werkzeug) => {
    const strom = client.messages.stream(anfrage(werkzeug));
    return strom.finalMessage();
  };

  let antwort;
  try {
    antwort = await laufen(WERKZEUG_NEU);
  } catch (e) {
    if (e?.status !== 400) throw e;
    antwort = await laufen(WERKZEUG_ALT);
  }

  const text = antwort.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  // ── Sichtbar machen, was passiert ist ─────────────────────────────
  //
  // "Keine News" kann drei sehr verschiedene Dinge heißen: Das Modell hat
  // gesucht und nichts gefunden; es hat geantwortet, aber mit IDs, die wir
  // nicht zuordnen können; oder die Suche lief gar nicht. Von außen sieht
  // alles drei gleich aus — genau so blieb ein Lauf über 70 Spieler ohne
  // ein einziges Ergebnis unerklärlich.
  const suchen = antwort.content.filter((b) => b.type === "web_search_tool_result").length;
  const suchfehler = antwort.content.filter(
    (b) => b.type === "web_search_tool_result" && !Array.isArray(b.content)
  ).length;

  const roh = findeArray(text);
  if (!roh) {
    const grund = antwort.stop_reason === "max_tokens"
      ? "Antwort war zu lang und wurde abgeschnitten"
      : "Antwort enthielt kein auswertbares JSON";
    throw new Error(grund);
  }

  const erlaubt = new Set(spieler.map((s) => String(s.id)));
  const meldungen = [];
  let verworfen = 0;
  for (const r of roh) {
    const m = saubereMeldung(r, erlaubt);
    if (m) meldungen.push(m);
    else verworfen++;
  }

  return {
    meldungen,
    diagnose: {
      suchen,
      suchfehler,
      eintraege: roh.length,
      verworfen,
      mitMeldung: meldungen.filter((m) => m.text).length,
      stopGrund: antwort.stop_reason ?? null,
      // Ein kurzer Ausschnitt hilft, wenn gar nichts zusammenpasst.
      probe: verworfen > 0 || meldungen.length === 0 ? text.slice(0, 300) : null,
    },
  };
}
