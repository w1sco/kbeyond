import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sitzung } from "@/lib/auth";
import { alleZugaenge, entscheide, OFFEN, FREI, GESPERRT } from "@/lib/zugang";
import { zeitpunkt } from "@/lib/format";

export const dynamic = "force-dynamic";

// Wer darf KBeyond benutzen?
//
// Die Seite gehört dem Betreiber. Jeder andere sieht sie gar nicht — und
// zwar geprüft **in der Server Action selbst**, nicht nur beim Rendern:
// Die Action ist eine eigene Adresse und lässt sich ohne die Seite
// aufrufen. Dieselbe Regel wie bei den Einstellungen.
async function entscheiden(formData) {
  "use server";
  const { kennung, admin } = await sitzung();
  if (!admin) redirect("/liga");

  const wen = String(formData.get("kennung") ?? "");
  const wie = String(formData.get("status") ?? "");
  await entscheide(wen, wie, kennung);
  revalidatePath("/zugang");
}

const TEXT = {
  [OFFEN]: "wartet auf Freigabe",
  [FREI]: "freigegeben",
  [GESPERRT]: "gesperrt",
};

export default async function Zugang() {
  const { admin } = await sitzung();
  if (!admin) redirect("/liga");

  const liste = await alleZugaenge();
  const offen = liste.filter((z) => z.status === OFFEN);
  const ohneUmgebung = !process.env.ZUGANG_ADMINS;

  return (
    <main className="kb-seite kb-seite--schmal">
      <header className="kb-kopf">
        <div>
          <Link href="/liga" className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Zugang</h1>
          <p className="kb-unter">Wer darf KBeyond benutzen?</p>
        </div>
      </header>

      {ohneUmgebung && (
        <div className="kb-hinweis kb-hinweis--warn">
          <strong>Kein Betreiber in der Umgebung hinterlegt.</strong> Betreiber ist
          gerade, wer sich als Erster angemeldet hat. Sicherer ist{" "}
          <code>ZUGANG_ADMINS</code> in den Vercel-Einstellungen — kommagetrennte
          E-Mail-Adressen. Dann steht es fest, egal wer wann zuerst da war.
        </div>
      )}

      <div className={`kb-hinweis${offen.length ? " kb-hinweis--info" : ""}`}>
        {offen.length === 0
          ? "Keine offenen Anfragen."
          : `${offen.length} ${offen.length === 1 ? "Anfrage wartet" : "Anfragen warten"} auf dich.`}
      </div>

      {liste.length === 0 ? (
        <p className="kb-info">Noch niemand hat sich angemeldet.</p>
      ) : (
        <div className="kb-tabellenrahmen">
          <table className="kb-tabelle kb-tabelle--schmal">
            <thead>
              <tr>
                <th className="kb-namensspalte">Wer</th>
                <th>Stand</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {liste.map((z, i) => (
                <tr key={z.kennung} className={i % 2 ? "kb-zeile--grau" : "kb-zeile--weiss"}>
                  <td className="kb-namensspalte">
                    <span className="kb-spielername">{z.name || z.kennung}</span>
                    {z.admin && <span className="kb-leise"> · Betreiber</span>}
                    <div className="kb-leise">
                      {z.name ? `${z.kennung} · ` : ""}
                      {z.versuche} {z.versuche === 1 ? "Anmeldung" : "Anmeldungen"}
                      {z.zuletzt ? `, zuletzt ${zeitpunkt(z.zuletzt)}` : ""}
                    </div>
                  </td>
                  <td>
                    <span className={
                      z.status === FREI ? "kb-plus"
                        : z.status === GESPERRT ? "kb-minus" : "kb-warntext"
                    }>
                      {TEXT[z.status] ?? z.status}
                    </span>
                  </td>
                  <td>
                    <form action={entscheiden} className="kb-zugangknoepfe">
                      <input type="hidden" name="kennung" value={z.kennung} />
                      {z.status !== FREI && (
                        <button className="kb-btn kb-btn--haupt kb-btn--klein"
                                name="status" value={FREI}>
                          Freigeben
                        </button>
                      )}
                      {z.status !== GESPERRT && !z.admin && (
                        <button className="kb-btn kb-btn--klein" name="status" value={GESPERRT}>
                          Sperren
                        </button>
                      )}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="kb-legende">
        Eine Sperre wirkt sofort — die offenen Fenster dieses Menschen fliegen
        mit heraus, statt bis zum Ablauf seines Kickbase-Tokens weiterzulaufen.
        Ein Betreiber lässt sich nicht sperren; sonst könnte am Ende niemand mehr
        freigeben.
      </p>
    </main>
  );
}
