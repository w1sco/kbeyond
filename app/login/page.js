"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();

  async function submit() {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    if (res.ok) router.push("/liga");
    else setErr("Anmeldung fehlgeschlagen");
  }

  return (
    <div style={{ maxWidth: 320, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h1>KBeyond</h1>
      <input placeholder="E-Mail" value={email}
        onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      <input type="password" placeholder="Passwort" value={pw}
        onChange={(e) => setPw(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      <button onClick={submit}>Anmelden</button>
      {err && <p style={{ color: "crimson" }}>{err}</p>}
    </div>
  );
}
