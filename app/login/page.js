"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const router = useRouter();

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setLaeuft(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pw }),
      });
      if (res.ok) router.push("/liga");
      else setErr("Anmeldung fehlgeschlagen");
    } catch {
      setErr("Keine Verbindung zu Kickbase");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <main className="kb-seite" style={{ maxWidth: 380, paddingTop: 72 }}>
      <h1 className="kb-titel">KBeyond</h1>
      <p className="kb-unter" style={{ marginBottom: 20 }}>
        Anmeldung mit den Kickbase-Zugangsdaten.
      </p>

      <form className="kb-karte" onSubmit={submit}>
        <label className="kb-feld" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <span className="kb-label">E-Mail</span>
          <input
            className="kb-eingabe kb-eingabe--voll"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="kb-feld" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <span className="kb-label">Passwort</span>
          <input
            className="kb-eingabe kb-eingabe--voll"
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>

        <button type="submit" className="kb-btn kb-btn--stark" style={{ width: "100%" }} disabled={laeuft}>
          {laeuft ? "Anmelden …" : "Anmelden"}
        </button>

        {err && <p className="kb-hinweis kb-hinweis--fehler" style={{ marginTop: 12, marginBottom: 0 }}>{err}</p>}
      </form>
    </main>
  );
}
