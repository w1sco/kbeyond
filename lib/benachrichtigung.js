// Eine Zugangsanfrage soll den Betreiber erreichen, nicht auf einer Seite
// warten, die er zufällig aufruft.
//
// ── Warum überhaupt ein Schlüssel auf dem Server ────────────────────
//
// Das Projekt hält bewusst **keinen** eigenen API-Schlüssel vor: Bei „Frag
// die Liga" und den News zahlt jeder Nutzer selbst, damit die Kosten nicht
// beim Betreiber landen. Hier ist es umgekehrt — die Nachricht geht an den
// Betreiber, über seinen Zugang, für seine eigene App. Der Grundsatz
// bleibt: **Nichts, was ein Nutzer auslöst, kostet den Betreiber
// LLM-Guthaben.** Eine Anfrage-Mail ist keine LLM-Anfrage.
//
// ── Resend, und zwar über nacktes fetch ─────────────────────────────
//
// Kein npm-Paket: Ein HTTP-POST reicht, und jede Abhängigkeit weniger ist
// eine Abhängigkeit weniger. Ohne verifizierte Domain darf Resend nur an
// die Adresse des Kontoinhabers senden — genau dieser Fall.
const RESEND = "https://api.resend.com/emails";

// Wohin die Nachricht geht. Vorgabe ist die erste Betreiberadresse: Wer
// freigeben darf, will auch wissen, dass etwas anliegt.
function empfaenger() {
  const eigen = String(process.env.ZUGANG_MAIL_AN ?? "").trim();
  if (eigen.includes("@")) return eigen;
  const admins = String(process.env.ZUGANG_ADMINS ?? "")
    .split(",").map((s) => s.trim()).filter((s) => s.includes("@"));
  return admins[0] ?? null;
}

// Ist der Versand eingerichtet? Die Verwaltungsseite sagt das ausdrücklich,
// statt so zu tun, als käme schon eine Mail.
//
// **Ein stiller Ausfall sieht aus wie „es kam eben keine Anfrage".** Genau
// dieser Fehler hat im Projekt schon einmal 70 Spieler als „nichts
// gefunden" abgelegt, obwohl nie eine Antwort kam.
export function mailStand() {
  const an = empfaenger();
  const schluessel = Boolean(process.env.RESEND_API_KEY);
  if (!schluessel && !an) return { bereit: false, an: null, grund: "kein Schlüssel, kein Empfänger" };
  if (!schluessel) return { bereit: false, an, grund: "RESEND_API_KEY fehlt" };
  if (!an) return { bereit: false, an: null, grund: "ZUGANG_MAIL_AN fehlt" };
  return { bereit: true, an, grund: null };
}

// Wo die App erreichbar ist — für den Link in der Mail. Vercel setzt die
// Domain selbst; ohne sie steht der Pfad ohne Herkunft da, was immer noch
// besser ist als eine erfundene Adresse.
function adresse() {
  const eigen = process.env.ZUGANG_URL;
  if (eigen) return eigen.replace(/\/+$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "";
}

// Namen kommen von Kickbase-Nutzern. In einer HTML-Mail wären sie sonst
// Markup — dieselbe Regel wie bei der Frage-Funktion: Text von außen ist
// Text, keine Anweisung.
const sicher = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (z) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z]);

// Meldet eine neue Anfrage. Wirft **nie** — eine gescheiterte Mail darf
// die Anmeldung nicht mitreißen; die Anfrage steht ohnehin schon in der
// Datenbank. Zurück kommt, was passiert ist, damit die Verwaltungsseite es
// zeigen kann.
export async function meldeAnfrage({ kennung, name = null }) {
  const stand = mailStand();
  if (!stand.bereit) return { gesendet: false, fehler: stand.grund };

  const wer = name ? `${name} (${kennung})` : kennung;
  const wohin = adresse();
  const link = `${wohin}/zugang`;

  try {
    const res = await fetch(RESEND, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ZUGANG_MAIL_VON ?? "KBeyond <onboarding@resend.dev>",
        to: [stand.an],
        subject: `KBeyond: Zugangsanfrage von ${kennung}`,
        text:
          `${wer} hat sich bei KBeyond angemeldet und wartet auf deine Freigabe.\n\n` +
          `Freigeben oder sperren: ${link}\n\n` +
          `Bis dahin hat diese Person keine Sitzung und kommt auf keine Seite.`,
        html:
          `<p><strong>${sicher(wer)}</strong> hat sich bei KBeyond angemeldet und ` +
          `wartet auf deine Freigabe.</p>` +
          `<p><a href="${sicher(link)}">Freigeben oder sperren</a></p>` +
          `<p style="color:#666">Bis dahin hat diese Person keine Sitzung und ` +
          `kommt auf keine Seite.</p>`,
      }),
    });

    if (!res.ok) {
      // Den Grund mitnehmen, nicht nur „ging nicht" — sonst sucht man
      // später zwischen Schlüssel, Absender und Empfänger.
      const text = await res.text().catch(() => "");
      return { gesendet: false, fehler: `HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}` };
    }
    return { gesendet: true, fehler: null };
  } catch (e) {
    return { gesendet: false, fehler: e?.message ?? "unbekannter Fehler" };
  }
}
