"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Formular({ abgelaufen = false }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  // Vorbelegt: Wer sich anmeldet, will in aller Regel angemeldet bleiben.
  const [bleiben, setBleiben] = useState(true);
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
        body: JSON.stringify({ email, password: pw, bleiben }),
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
    <>
      {abgelaufen && (
        <div className="kb-hinweis kb-hinweis--warn" style={{ marginBottom: 16 }}>
          Sitzung abgelaufen — bitte neu anmelden.
        </div>
      )}

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

        <label className="kb-ankreuz">
          <input
            type="checkbox"
            checked={bleiben}
            onChange={(e) => setBleiben(e.target.checked)}
          />
          <span>Angemeldet bleiben</span>
        </label>

        <button type="submit" className="kb-btn kb-btn--stark" style={{ width: "100%" }} disabled={laeuft}>
          {laeuft ? "Anmelden …" : "Anmelden"}
        </button>

        {err && <p className="kb-hinweis kb-hinweis--fehler" style={{ marginTop: 12, marginBottom: 0 }}>{err}</p>}
      </form>
    </>
  );
}
