import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sitzung } from "@/lib/auth";
import { alleZugaenge, entscheide, setzePrivat, OFFEN, FREI, GESPERRT } from "@/lib/zugang";
import { zeitpunkt } from "@/lib/format";
import { mailStand } from "@/lib/benachrichtigung";

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

// Wessen Zahlen sind für die anderen sichtbar?
//
// Prüft **selbst**, wie jede Server Action: Sie ist eine eigene Adresse
// und lässt sich ohne die Seite aufrufen.
async function privatSchalten(formData) {
  "use server";
  const { admin } = await sitzung();
  if (!admin) redirect("/liga");

  await setzePrivat(String(formData.get("kennung") ?? ""), formData.get("privat") === "1");
  revalidatePath("/zugang");
  revalidatePath("/liga");
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
  const post = mailStand();

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

      {/* Ob eine Mail kommt, darf man nicht annehmen müssen. Ein stiller
          Ausfall sähe hier aus wie „es hat eben niemand angefragt". */}
      <div className={`kb-hinweis ${post.bereit ? "kb-hinweis--gut" : "kb-hinweis--warn"}`}>
        {post.bereit ? (
          <>Neue Anfragen gehen per Mail an <strong>{post.an}</strong>.</>
        ) : (
          <>
            <strong>Keine Benachrichtigung eingerichtet</strong> ({post.grund}) — neue
            Anfragen siehst du nur hier. Dafür braucht es in den
            Vercel-Einstellungen <code>RESEND_API_KEY</code> und{" "}
            <code>ZUGANG_MAIL_AN</code>.
          </>
        )}
      </div>

      <div className={`kb-hinweis${offen.length ? " kb-hinweis--info" : ""}`}>
        {offen.length === 0
          ? "Keine offenen Anfragen."
          : `${offen.length} ${offen.length === 1 ? "Anfrage wartet" : "Anfragen warten"} auf dich.`}
      </div>

      {liste.length === 0 ? (
        <p className="kb-info">Noch niemand hat sich angemeldet.</p>
      ) : (
        // Bewusst **keine Tabelle**. Als Tabelle mit Mindestbreite lagen
        // „Freigeben" und „Ablehnen" auf dem Handy 120 px rechts neben dem
        // Bildschirmrand — sichtbar erst nach seitlichem Wischen im Rahmen,
        // worauf nichts hindeutet. Der Nutzer sah die Anfrage und fand
        // keinen Weg, sie zu entscheiden. Eine Aktion, die man nicht
        // findet, gibt es nicht.
        <ul className="kb-zugangliste">
          {liste.map((z) => (
            <li key={z.kennung}
                className={`kb-zugangkarte${z.status === OFFEN ? " kb-zugangkarte--offen" : ""}`}>
              <div className="kb-zugangkopf">
                <span className="kb-spielername">{z.name || z.kennung}</span>
                {z.admin && <span className="kb-leise"> · Betreiber</span>}
                <span className={
                  z.status === FREI ? "kb-plus"
                    : z.status === GESPERRT ? "kb-minus" : "kb-warntext"
                }>
                  {TEXT[z.status] ?? z.status}
                </span>
              </div>

              <div className="kb-leise">
                {z.name ? `${z.kennung} · ` : ""}
                {z.versuche} {z.versuche === 1 ? "Anmeldung" : "Anmeldungen"}
                {z.zuletzt ? `, zuletzt ${zeitpunkt(z.zuletzt)}` : ""}
                {z.entschieden ? ` · entschieden ${zeitpunkt(z.entschieden)}` : ""}
              </div>

              {z.melde_fehler && (
                <div className="kb-minus">
                  Benachrichtigung ging nicht raus: {z.melde_fehler}
                </div>
              )}

              <form action={entscheiden} className="kb-zugangknoepfe">
                <input type="hidden" name="kennung" value={z.kennung} />
                {z.status !== FREI && (
                  <button className="kb-btn kb-btn--haupt" name="status" value={FREI}>
                    Freigeben
                  </button>
                )}
                {/* Eine offene Anfrage wird **abgelehnt**, ein Freigegebener
                    wird **gesperrt**. Dahinter steht derselbe Status — aber
                    „Sperren" neben einer Anfrage, die nie offen war, liest
                    sich wie eine Strafe. */}
                {z.status !== GESPERRT && !z.admin && (
                  <button className="kb-btn" name="status" value={GESPERRT}>
                    {z.status === OFFEN ? "Ablehnen" : "Sperren"}
                  </button>
                )}
              </form>

              {/* Nur bei Freigegebenen: Wer nicht hereinkommt, steht in
                  keiner Ligatabelle und hat dort nichts zu verbergen. */}
              {z.status === FREI && (
                <form action={privatSchalten} className="kb-zugangprivat">
                  <input type="hidden" name="kennung" value={z.kennung} />
                  <input type="hidden" name="privat" value={z.zahlen_privat ? "0" : "1"} />
                  <span className="kb-leise">
                    {z.zahlen_privat
                      ? "🔒 Finanzzahlen für andere verborgen"
                      : "Finanzzahlen für alle sichtbar"}
                  </span>
                  <button className="kb-btn kb-btn--klein">
                    {z.zahlen_privat ? "Zeigen" : "Verbergen"}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="kb-legende">
        <strong>Verborgene Finanzzahlen</strong> heißt: Kontostand, Limit, Max-Gebot,
        Gesamtwert, Liquidität und Anpassungen sind für alle anderen zu — in der
        Tabelle, auf der Managerseite, im Verlauf, in den Summen der Marktseite und im
        Datensatz für „Frag die Liga“. Teamwert, Punkte und Kader bleiben sichtbar; die
        stehen in Kickbase ohnehin. Und es ist keine Geheimhaltung: Wer die Rechnung
        dieses Projekts selbst nachbaut, kommt über den Liga-Feed zum selben Ergebnis.
        Vorbelegt ist der Betreiber auf verborgen, alle anderen auf sichtbar.
      </p>

      <p className="kb-legende">
        Eine Sperre wirkt sofort — die offenen Fenster dieses Menschen fliegen
        mit heraus, statt bis zum Ablauf seines Kickbase-Tokens weiterzulaufen.
        Ein Betreiber lässt sich nicht sperren; sonst könnte am Ende niemand mehr
        freigeben.
      </p>
    </main>
  );
}
