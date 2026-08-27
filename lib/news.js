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

// Wie viele Spieler in eine Anfrage gehen. Klein genug, dass das Modell je
// Spieler wirklich sucht, groß genug, dass ein Kader nicht 15 Anfragen
// kostet.
export const BUENDEL = 5;

// Wie lange eine Meldung als frisch gilt. Zweimal am Tag laden soll nicht
// jedes Mal neu bezahlt werden.
export const FRISCH_STUNDEN = 12;

// Die Websuche gibt es in zwei Fassungen; welche gilt, hängt am Modell.
const WERKZEUG_NEU = "web_search_20260209";
const WERKZEUG_ALT = "web_search_20250305";

const ANWEISUNG = `Du recherchierst Nachrichten zu Fußballspielern der deutschen Bundesliga für ein Kickbase-Analysewerkzeug.

Für JEDEN genannten Spieler:
1. Suche im Netz nach Meldungen der letzten ${TAGE_ZURUECK} Tage.
2. Fasse zusammen, was für einen Kickbase-Manager zählt: Verletzung, Sperre,
   Ausfallzeit, Rückkehr ins Training, Startelf oder Bank, Formkurve,
   Trainerurteil, Wechselgerüchte, Vertragsverlängerung.
3. Schreibe kurz und knapp: höchstens drei Sätze, deutsch, ohne Floskeln.
   Keine Einleitung, keine Wiederholung des Namens.

Nutze das ganze Spektrum der Quellen — überregionale (kicker, ligainsider,
Sky, Bild), Vereins- und Regionalmedien (Deichstube, DerWesten, WAZ,
Express, Mopo) und Transfer-Journalisten wie Fabrizio Romano. Nenne zu
jeder Meldung die Quelle.

Gibt es zu einem Spieler nichts aus den letzten ${TAGE_ZURUECK} Tagen, ist das
ein gültiges Ergebnis: "text" leer lassen und "nichts" auf true setzen.
Erfinde nichts und rate nicht — lieber nichts als eine erfundene Meldung.

Antworte NUR mit einem JSON-Array, ohne Text davor oder danach:
[
  {
    "id": "<die mitgegebene Spieler-ID, unverändert>",
    "nichts": false,
    "text": "Zwei bis drei Sätze.",
    "stimmung": "gut" | "schlecht" | "neutral",
    "quellen": [{ "name": "kicker", "url": "https://..." }]
  }
]
"stimmung" aus Sicht eines Managers, der den Spieler besitzt: "schlecht"
bei Verletzung, Sperre oder Bankdrohung, "gut" bei Rückkehr oder starker
Form, sonst "neutral".`;

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
export async function holeNews({ schluessel, modell, spieler }) {
  const client = new Anthropic({ apiKey: schluessel });
  const liste = spieler
    .map((s) => `- id ${s.id}: ${s.name}${s.verein ? ` (${s.verein})` : ""}`)
    .join("\n");

  const anfrage = (werkzeug) => ({
    model: modell || "claude-opus-5",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tools: [
      {
        type: werkzeug,
        name: "web_search",
        // Genug Suchen für ein Bündel, aber gedeckelt – sonst läuft eine
        // einzelne Anfrage in Kosten und Zeit davon.
        max_uses: 12,
      },
    ],
    system: ANWEISUNG,
    messages: [
      {
        role: "user",
        content:
          `Heute ist ${new Date().toISOString().slice(0, 10)}.\n\n` +
          `Spieler:\n${liste}\n\n` +
          "Antworte nur mit dem JSON-Array.",
      },
    ],
  });

  // Welche Fassung der Websuche ein Modell versteht, hängt vom Modell ab —
  // und der Nutzer wählt sein Modell selbst. Statt das zu raten, wird die
  // neuere zuerst versucht und bei einer Ablehnung die ältere genommen.
  // Nur bei 400: alles andere (Schlüssel ungültig, Guthaben leer) soll
  // durchschlagen statt ein zweites Mal Geld zu kosten.
  let antwort;
  try {
    antwort = await client.messages.create(anfrage(WERKZEUG_NEU));
  } catch (e) {
    if (e?.status !== 400) throw e;
    antwort = await client.messages.create(anfrage(WERKZEUG_ALT));
  }

  const text = antwort.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const roh = findeArray(text);
  if (!roh) {
    const grund = antwort.stop_reason === "max_tokens"
      ? "Antwort war zu lang und wurde abgeschnitten"
      : "Antwort enthielt kein auswertbares JSON";
    throw new Error(grund);
  }

  const erlaubt = new Set(spieler.map((s) => String(s.id)));
  return roh.map((r) => saubereMeldung(r, erlaubt)).filter(Boolean);
}
