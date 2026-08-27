const BASE = "https://api.kickbase.com";

function pick(obj, keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
  }
  return undefined;
}

export async function kbLogin(email, password) {
  const res = await fetch(`${BASE}/v4/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ em: email, pass: password, loy: false }),
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

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Kickbase drosselt. Alle Importer fangen das mit einem Retry ab — kbFetch
// tat es nicht, obwohl jede Seite und die Mitgliedsprüfung darüber laufen.
// Ein 429 direkt nach "Alles aktualisieren" führte deshalb dazu, dass die
// Prüfung den Nutzer für kein Mitglied hielt.
export async function kbFetch(path, token, versuch = 0) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if ((res.status === 429 || res.status === 503) && versuch < 3) {
    await schlaf(600 * Math.pow(2, versuch));
    return kbFetch(path, token, versuch + 1);
  }

  if (!res.ok) {
    const fehler = new Error(`API-Fehler: ${res.status}`);
    fehler.status = res.status;
    throw fehler;
  }
  return res.json();
}
