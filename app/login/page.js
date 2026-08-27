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

      {/* Kickbase untersagt gewerbliche Nutzung und Datamining ohne
          Zustimmung. Das gehört dorthin, wo man sich verbindet — nicht in
          eine Fußzeile, die niemand liest. */}
      <p className="kb-info" style={{ marginTop: 16 }}>
        KBeyond liest Kickbase-Daten nur für dich und verändert dort nichts.
        Kickbase untersagt in seinen Bedingungen die gewerbliche Nutzung und das
        automatisierte Auslesen von Daten ohne Zustimmung — nutze das Werkzeug
        privat und für deine eigenen Ligen.
      </p>
    </main>
  );
}
