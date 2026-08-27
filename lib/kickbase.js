const BASE = "https://api.kickbase.com";

function pick(obj, keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
  }
  return undefined;
}

// Kickbase stuft einen Zugang nach Herkunft ein. Kommen die Aufrufe aus
// einer fremden Region oder ohne deutsche Spracheinstellung, kann der
// Account auf "international" umspringen — dann fehlen Inhalte, die es nur
// in der Bundesliga-Sicht gibt. Deshalb überall derselbe Sprachkopf; die
// Region wird über vercel.json auf Frankfurt festgelegt.
const SPRACHE = { "Accept-Language": "de-DE,de;q=0.9" };

export async function kbLogin(email, password, opt = {}) {
  const { angemeldetBleiben = false } = opt;

  // `loy` ist Kickbases eigenes Kennzeichen für "angemeldet bleiben". Es
  // stand hier fest auf false — also wurde bei jeder Anmeldung die kurze
  // Sitzung angefordert, auch wenn der Nutzer sie gar nicht wollte.
  const res = await fetch(`${BASE}/v4/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...SPRACHE },
    body: JSON.stringify({ em: email, pass: password, loy: angemeldetBleiben }),
  });
  if (!res.ok) throw new Error("Login fehlgeschlagen");
  const data = await res.json();

  const token = pick(data, ["tkn", "token"]);
  if (!token) throw new Error("Kein Token in der Antwort");

  const u = data.u ?? data.usr ?? data.user ?? {};
  const userId = pick(u, ["i", "id", "ui"]) ?? pick(data, ["ui", "uid"]);
  const userName = pick(u, ["n", "name", "unm"]) ?? pick(data, ["unm"]);

  return { token, userId: userId ? String(userId) : null, userName: userName ?? null };
}

// ── Wie lange gilt das Token? ───────────────────────────────────────
//
// Nicht raten, sondern ablesen. Kickbase liefert ein JWT, und dessen
// Nutzlast trägt den Ablauf als `exp` (Sekunden seit 1970). Damit lässt
// sich das Cookie genau so lang setzen, wie das Token wirklich gilt —
// ein Cookie, das ein totes Token trägt, sieht aus wie "angemeldet" und
// ist es nicht.
//
// Alles daran ist unsicher: Es muss kein JWT sein, die Nutzlast muss kein
// `exp` enthalten, und der Wert muss nicht plausibel sein. Jeder Schritt
// prüft deshalb selbst und gibt im Zweifel null zurück.
const MAX_LAUFZEIT_MS = 400 * 24 * 3600_000;

export function tokenAblauf(token) {
  const teile = String(token ?? "").split(".");
  if (teile.length !== 3) return null;

  let nutzlast;
  try {
    const roh = teile[1].replace(/-/g, "+").replace(/_/g, "/");
    nutzlast = JSON.parse(Buffer.from(roh, "base64").toString("utf8"));
  } catch {
    return null;
  }

  const exp = Number(nutzlast?.exp);
  if (!Number.isFinite(exp) || exp <= 0) return null;

  // Plausibilitätsgrenze: in der Zukunft, aber nicht jenseits von Gut und
  // Böse. Ein Wert in Millisekunden statt Sekunden landet sonst im Jahr
  // 56000 und das Cookie liefe faktisch nie ab.
  const ms = exp * 1000;
  if (ms <= Date.now() || ms > Date.now() + MAX_LAUFZEIT_MS) return null;
  return new Date(ms);
}

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Bremse ──────────────────────────────────────────────────────────
//
// Kickbase drosselt, und ein Aktualisieren-Lauf feuerte früher 60 bis 300
// Anfragen mit 180–250 ms Abstand ab. Nach mehrfachem Klicken führte das zu
// Ablehnungen — und im schlimmsten Fall zu einer Sperre des Kontos.
//
// Deshalb genau eine Stelle, durch die alle Aufrufe laufen:
//
//   1. Mindestabstand zwischen zwei Anfragen, für alle Lader gemeinsam
//   2. Bei 429/503 wird gewartet und wiederholt, mit wachsendem Abstand
//   3. Bleibt es dabei, gilt der ganze Lauf als gedrosselt und JEDER
//      weitere Aufruf bricht sofort ab, statt die Lage zu verschärfen
//
// Punkt 3 ist der wichtigste: Vorher hat jeder Lader für sich weitergemacht
// und die Drosselung damit verlängert.

const MIN_ABSTAND_MS = 600;
const MAX_VERSUCHE = 3;

let letzterRuf = 0;
let gedrosselt = false;

export class GedrosseltFehler extends Error {
  constructor() {
    super("Kickbase drosselt gerade – Lauf abgebrochen, später weitermachen");
    this.name = "GedrosseltFehler";
    this.gedrosselt = true;
  }
}

// Für einen neuen Lauf zurücksetzen (eine Serverless-Instanz kann mehrere
// Anfragen nacheinander bedienen).
export function bremseZuruecksetzen() {
  gedrosselt = false;
}

export function istGedrosselt() {
  return gedrosselt;
}

async function abstandHalten() {
  const seit = Date.now() - letzterRuf;
  if (seit < MIN_ABSTAND_MS) await schlaf(MIN_ABSTAND_MS - seit);
  letzterRuf = Date.now();
}

export async function kbFetch(path, token, versuch = 0) {
  if (gedrosselt) throw new GedrosseltFehler();

  await abstandHalten();

  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...SPRACHE },
    cache: "no-store",
  });

  if (res.status === 429 || res.status === 503) {
    if (versuch >= MAX_VERSUCHE) {
      // Ab jetzt bricht jeder weitere Aufruf dieses Laufs sofort ab.
      gedrosselt = true;
      throw new GedrosseltFehler();
    }
    // Wenn Kickbase sagt, wie lange, halten wir uns daran.
    const sagt = Number(res.headers.get("retry-after"));
    const warten = Number.isFinite(sagt) && sagt > 0
      ? Math.min(sagt * 1000, 8000)
      : 800 * Math.pow(2, versuch);
    await schlaf(warten);
    return kbFetch(path, token, versuch + 1);
  }

  if (!res.ok) {
    const fehler = new Error(`API-Fehler: ${res.status}`);
    fehler.status = res.status;
    throw fehler;
  }
  return res.json();
}
