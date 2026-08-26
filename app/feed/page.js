import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kbFetch } from "@/lib/kickbase";

export const dynamic = "force-dynamic";

const KANDIDATEN = (id, start, max) => [
  `/v4/leagues/${id}/activitiesFeed?start=${start}&max=${max}`,
  `/v4/leagues/${id}/activities?start=${start}&max=${max}`,
  `/v4/leagues/${id}/activitiesFeed`,
  `/v4/leagues/${id}/feed?start=${start}&max=${max}`,
];

export default async function Feed({ searchParams }) {
  const store = await cookies();
  const token = store.get("kb_token")?.value;
  if (!token) redirect("/login");

  const p = await searchParams;
  const leagueId = p.league ?? "6423644";
  const start = p.start ?? "0";
  const max = p.max ?? "30";

  const versuche = [];
  let treffer = null;

  for (const pfad of KANDIDATEN(leagueId, start, max)) {
    try {
      const daten = await kbFetch(pfad, token);
      versuche.push({ pfad, status: "OK" });
      if (!treffer) treffer = { pfad, daten };
    } catch (e) {
      versuche.push({ pfad, status: e.message });
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>Feed-Diagnose · Liga {leagueId}</h1>

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Getestete Endpoints</h2>
      <ul style={{ fontSize: 13, lineHeight: 1.7 }}>
        {versuche.map((v) => (
          <li key={v.pfad}>
            <code>{v.pfad}</code> → <strong>{v.status}</strong>
          </li>
        ))}
      </ul>

      {treffer ? (
        <>
          <h2 style={{ fontSize: 15, marginTop: 24 }}>Antwort von {treffer.pfad}</h2>
          <pre style={{ background: "#f8fafc", padding: 14, borderRadius: 8, fontSize: 11, overflowX: "auto" }}>
            {JSON.stringify(treffer.daten, null, 2)}
          </pre>
        </>
      ) : (
        <p>Kein Endpoint hat funktioniert.</p>
      )}
    </main>
  );
}
