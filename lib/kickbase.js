const BASE = "https://api.kickbase.com";

export async function kbLogin(email, password) {
  const res = await fetch(`${BASE}/v4/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ em: email, pass: password, loy: false }),
  });
  if (!res.ok) throw new Error("Login fehlgeschlagen");
  const data = await res.json();
  return data.tkn;
}

export async function kbFetch(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API-Fehler: ${res.status}`);
  return res.json();
}
