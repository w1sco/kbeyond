import Formular from "./Formular";

export const dynamic = "force-dynamic";

// Server-Teil, damit das Formular den Grund für die Anmeldung kennt, ohne
// dass eine Client-Komponente useSearchParams benutzen muss — das
// verlangte sonst eine Suspense-Grenze um das ganze Formular.
export default async function Login({ searchParams }) {
  const p = await searchParams;

  return (
    <main className="kb-seite" style={{ maxWidth: 380, paddingTop: 72 }}>
      <h1 className="kb-titel">KBeyond</h1>
      <p className="kb-unter" style={{ marginBottom: 20 }}>
        Anmeldung mit den Kickbase-Zugangsdaten. Sie werden an Kickbase
        weitergereicht und hier nicht gespeichert — abgelegt wird nur das
        Sitzungs-Token in einem httpOnly-Cookie.
      </p>

      <Formular abgelaufen={p.abgelaufen === "1"} />
    </main>
  );
}
