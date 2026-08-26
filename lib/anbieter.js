import Anthropic from "@anthropic-ai/sdk";

// Drei Anbieter, ein Verhalten.
//
// Der Schlüssel gehört dem Nutzer und kommt bei jeder Frage mit. Er wird
// weder gespeichert noch protokolliert — er wird einmal benutzt und ist
// danach wieder weg. Damit liegen die Kosten beim Fragenden.

export const ANBIETER = {
  claude: {
    name: "Claude (Anthropic)",
    schluesselHilfe: "console.anthropic.com → API Keys",
    standardModell: "claude-opus-5",
  },
  chatgpt: {
    name: "ChatGPT (OpenAI)",
    schluesselHilfe: "platform.openai.com → API keys",
    standardModell: null,
  },
  gemini: {
    name: "Gemini (Google)",
    schluesselHilfe: "aistudio.google.com → Get API key",
    standardModell: null,
  },
};

// Welche Modelle es gibt, wird beim Anbieter erfragt statt geraten.
// Modellnamen ändern sich laufend; eine fest verdrahtete Liste wäre in
// wenigen Monaten falsch.
export async function holeModelle(anbieter, schluessel) {
  if (anbieter === "claude") {
    const client = new Anthropic({ apiKey: schluessel });
    const liste = await client.models.list({ limit: 50 });
    return liste.data.map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
  }

  if (anbieter === "chatgpt") {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${schluessel}` },
    });
    if (!res.ok) throw new Error(await fehlertext(res));
    const daten = await res.json();
    return (daten.data ?? [])
      .map((m) => ({ id: m.id, name: m.id }))
      .filter((m) => /^(gpt|o\d)/.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  if (anbieter === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(schluessel)}`
    );
    if (!res.ok) throw new Error(await fehlertext(res));
    const daten = await res.json();
    return (daten.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("streamGenerateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName ?? m.name }));
  }

  throw new Error(`Unbekannter Anbieter: ${anbieter}`);
}

async function fehlertext(res) {
  const roh = await res.text().catch(() => "");
  try {
    const j = JSON.parse(roh);
    return j.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return roh.slice(0, 200) || `HTTP ${res.status}`;
  }
}

// Zerlegt einen SSE-Strom in einzelne data-Zeilen. OpenAI und Gemini
// liefern beide dieses Format, nur mit unterschiedlicher Nutzlast.
export async function* sseZeilen(res) {
  const leser = res.body.getReader();
  const dekoder = new TextDecoder();
  let puffer = "";

  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    puffer += dekoder.decode(value, { stream: true });

    const teile = puffer.split("\n");
    puffer = teile.pop() ?? "";
    for (const zeile of teile) {
      const t = zeile.trim();
      if (!t.startsWith("data:")) continue;
      const inhalt = t.slice(5).trim();
      if (inhalt === "[DONE]") return;
      try {
        yield JSON.parse(inhalt);
      } catch {
        // unvollständiges JSON überspringen
      }
    }
  }
}

// Liefert einen Strom von Textstücken – für alle Anbieter gleich, damit die
// Route und die Oberfläche keinen Anbieter kennen müssen.
export async function* frageStream({ anbieter, schluessel, modell, anweisung, datensatz, frage }) {
  const system = `${anweisung}\n\n--- DATENSATZ ANFANG ---\n${datensatz}\n--- DATENSATZ ENDE ---`;

  if (anbieter === "claude") {
    const client = new Anthropic({ apiKey: schluessel });
    const strom = client.messages.stream({
      model: modell || ANBIETER.claude.standardModell,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // Der Datensatz ist der stabile Teil und wird zwischengespeichert:
      // die erste Frage zahlt ihn, jede weitere liest ihn viel billiger.
      system: [
        { type: "text", text: anweisung },
        {
          type: "text",
          text: `--- DATENSATZ ANFANG ---\n${datensatz}\n--- DATENSATZ ENDE ---`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: frage }],
    });

    for await (const teil of strom) {
      if (teil.type === "content_block_delta" && teil.delta.type === "text_delta") {
        yield teil.delta.text;
      }
    }
    return;
  }

  if (anbieter === "chatgpt") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${schluessel}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modell,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: frage },
        ],
      }),
    });
    if (!res.ok) throw new Error(await fehlertext(res));

    for await (const stueck of sseZeilen(res)) {
      const text = stueck.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
    return;
  }

  if (anbieter === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modell)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(schluessel)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: frage }] }],
        }),
      }
    );
    if (!res.ok) throw new Error(await fehlertext(res));

    for await (const stueck of sseZeilen(res)) {
      for (const teil of stueck.candidates?.[0]?.content?.parts ?? []) {
        if (teil.text) yield teil.text;
      }
    }
    return;
  }

  throw new Error(`Unbekannter Anbieter: ${anbieter}`);
}
