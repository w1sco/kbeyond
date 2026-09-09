import { createHash } from "crypto";
import { sql } from "./db.js";

// Wer darf diese App überhaupt benutzen?
//
// Die Anmeldung geht an Kickbase — jeder mit einem Kickbase-Konto käme
// sonst herein. Deshalb eine eigene Liste: Eine neue E-Mail stellt eine
// **Anfrage**, und erst eine Freigabe macht daraus eine Sitzung.
//
// ── Woran die Freigabe hängt: am Token, nicht am Cookie ─────────────
//
// Ein Cookie mit der Nutzerkennung wäre leicht gefälscht — wer eine
// freigegebene Adresse errät, käme damit an der Liste vorbei. Das Token
// dagegen bekommt man nur, indem man sich wirklich bei Kickbase mit
// diesem Konto anmeldet.
//
// Beim Anmelden wird deshalb ein **Fingerabdruck des Tokens** abgelegt
// und der Freigabe zugeordnet. Jeder spätere Aufruf schlägt darüber nach.
// Das Token selbst steht nirgends in der Datenbank: gespeichert wird nur
// sein SHA-256, aus dem sich das Token nicht zurückrechnen lässt.
const FINGER = (token) =>
  createHash("sha256").update(String(token ?? "")).digest("hex");

export const OFFEN = "offen";
export const FREI = "frei";
export const GESPERRT = "gesperrt";

let angelegt = false;

async function schema() {
  if (angelegt) return;
  await sql`
    CREATE TABLE IF NOT EXISTS zugang (
      kennung     TEXT PRIMARY KEY,
      name        TEXT,
      kb_uid      TEXT,
      status      TEXT NOT NULL DEFAULT 'offen',
      admin       BOOLEAN NOT NULL DEFAULT FALSE,
      angefragt   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      entschieden TIMESTAMPTZ,
      von         TEXT,
      versuche    INT NOT NULL DEFAULT 0,
      zuletzt     TIMESTAMPTZ
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS zugang_sitzung (
      finger   TEXT PRIMARY KEY,
      kennung  TEXT NOT NULL,
      angelegt TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS zugang_sitzung_kennung ON zugang_sitzung (kennung)`;
  // Ob der Betreiber über die Anfrage benachrichtigt wurde — und woran es
  // sonst lag. Ohne den Fehlertext sähe eine nicht eingerichtete Mail
  // genauso aus wie eine, die unterwegs verloren ging.
  await sql`ALTER TABLE zugang ADD COLUMN IF NOT EXISTS gemeldet TIMESTAMPTZ`;
  await sql`ALTER TABLE zugang ADD COLUMN IF NOT EXISTS melde_fehler TEXT`;
  // Verbirgt diese Person ihre Finanzzahlen vor den anderen?
  //
  // **Bewusst ohne Vorgabewert und damit NULL-bar.** NULL heißt „nicht
  // entschieden" und fällt auf `admin` zurück: Der Betreiber steht
  // vorbelegt auf privat, alle anderen offen — sonst wäre der Zweck
  // dieser App (die Kontostände aller Manager) beim ersten Mitspieler
  // erledigt. Sobald jemand den Schalter anfasst, steht dort ein echtes
  // true/false, und die Vorgabe greift nie wieder.
  await sql`ALTER TABLE zugang ADD COLUMN IF NOT EXISTS zahlen_privat BOOLEAN`;
  angelegt = true;
}

// E-Mails unterscheiden sich in Groß- und Kleinschreibung nicht. Ohne
// Normalisierung stünde derselbe Mensch zweimal in der Liste — einmal
// freigegeben, einmal offen.
export function kennungAus(email) {
  const k = String(email ?? "").trim().toLowerCase();
  return k.includes("@") ? k : "";
}

// Wer ist von vornherein Betreiber? Aus der Umgebung, kommagetrennt.
function ausUmgebung() {
  return new Set(
    String(process.env.ZUGANG_ADMINS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes("@"))
  );
}

// ── Die Anmeldung ────────────────────────────────────────────────────
//
// Gibt zurück, ob diese Anmeldung durchgeht. Ein unbekannter Mensch legt
// dabei seine Anfrage an — **ohne** eine Sitzung zu bekommen.
export async function pruefeAnmeldung({ email, token, name = null, uid = null }) {
  await schema();

  const kennung = kennungAus(email);
  if (!kennung) return { status: GESPERRT, admin: false };

  const admins = ausUmgebung();

  // Der erste Mensch überhaupt wird Betreiber — sonst könnte niemand die
  // erste Freigabe erteilen und die App wäre für alle zu, auch für den
  // Besitzer. Steht `ZUGANG_ADMINS` in der Umgebung, gilt nur die Liste.
  const [{ anzahl }] = await sql`SELECT COUNT(*)::int AS anzahl FROM zugang`;
  const istAdmin = admins.has(kennung) || (admins.size === 0 && anzahl === 0);

  const start = istAdmin ? FREI : OFFEN;

  // Getrennt statt als ein Upsert: Nur so ist zu erkennen, ob die Anfrage
  // **neu** ist. Und nur eine neue Anfrage darf eine Nachricht auslösen —
  // sonst bekäme der Betreiber bei jedem Anmeldeversuch desselben Menschen
  // eine weitere Mail.
  const [vorher] = await sql`SELECT status FROM zugang WHERE kennung = ${kennung}`;
  const neu = !vorher;

  const [zeile] = neu
    ? await sql`
        INSERT INTO zugang (kennung, name, kb_uid, status, admin, versuche, zuletzt)
        VALUES (${kennung}, ${name}, ${uid}, ${start}, ${istAdmin}, 1, NOW())
        RETURNING status, admin`
    : await sql`
        UPDATE zugang SET
          name     = COALESCE(${name}, name),
          kb_uid   = COALESCE(${uid}, kb_uid),
          -- Eine Freigabe aus der Umgebung sticht durch, eine Sperre bleibt.
          status   = CASE WHEN ${istAdmin} AND status <> ${GESPERRT}
                          THEN ${FREI} ELSE status END,
          admin    = admin OR ${istAdmin},
          versuche = versuche + 1,
          zuletzt  = NOW()
        WHERE kennung = ${kennung}
        RETURNING status, admin`;

  if (zeile.status !== FREI) return { status: zeile.status, admin: false, neu, kennung };

  // Erst jetzt bekommt das Token seine Freigabe.
  await sql`
    INSERT INTO zugang_sitzung (finger, kennung) VALUES (${FINGER(token)}, ${kennung})
    ON CONFLICT (finger) DO NOTHING`;

  return { status: FREI, admin: zeile.admin, neu, kennung };
}

// ── Jeder spätere Aufruf ─────────────────────────────────────────────
//
// Null heißt: nicht freigegeben. Das gilt auch für ein Token, das nie
// durch die Anmeldung hier gelaufen ist — ein alter Sitzungs-Cookie von
// vor der Freigabeliste kommt damit nicht mehr durch.
export async function zugangZuToken(token) {
  if (!token) return null;
  await schema();
  const [z] = await sql`
    SELECT z.kennung, z.status, z.admin, z.name
      FROM zugang_sitzung s JOIN zugang z ON z.kennung = s.kennung
     WHERE s.finger = ${FINGER(token)}`;
  return z ?? null;
}

// ── Für die Verwaltung ───────────────────────────────────────────────

export async function alleZugaenge() {
  await schema();
  return await sql`
    SELECT kennung, name, kb_uid, status, admin, angefragt, entschieden, von,
           versuche, zuletzt, gemeldet, melde_fehler,
           COALESCE(zahlen_privat, admin) AS zahlen_privat
      FROM zugang
     ORDER BY (status = ${OFFEN}) DESC, angefragt DESC`;
}

// Was aus der Benachrichtigung wurde. Auch ein Fehlschlag wird vermerkt —
// sonst steht später „keine Mail bekommen" gegen „müsste eigentlich".
export async function merkeMeldung(kennung, fehler = null) {
  await schema();
  await sql`
    UPDATE zugang
       SET gemeldet = ${fehler ? null : new Date()}, melde_fehler = ${fehler}
     WHERE kennung = ${kennungAus(kennung)}`;
}

export async function offeneAnfragen() {
  await schema();
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM zugang WHERE status = ${OFFEN}`;
  return n;
}

// Freigeben, sperren oder zurück auf offen.
//
// **Ein Betreiber kann sich nicht selbst aussperren** — sonst gäbe es
// niemanden mehr, der freigeben darf, und die App wäre endgültig zu.
export async function entscheide(kennung, status, durch) {
  await schema();
  if (![OFFEN, FREI, GESPERRT].includes(status)) return { fehler: "unbekannter Status" };

  const ziel = kennungAus(kennung);
  if (!ziel) return { fehler: "unbekannte Kennung" };
  if (ziel === kennungAus(durch) && status !== FREI) {
    return { fehler: "Du kannst dich nicht selbst sperren" };
  }

  await sql`
    UPDATE zugang SET status = ${status}, entschieden = NOW(), von = ${durch}
     WHERE kennung = ${ziel}`;

  // Eine Sperre wirkt sofort: Die Sitzungen dieses Menschen fliegen raus,
  // sonst liefe sein offenes Fenster weiter, bis das Token abläuft.
  if (status !== FREI) {
    await sql`DELETE FROM zugang_sitzung WHERE kennung = ${ziel}`;
  }
  return { ok: true };
}

// ── Wessen Zahlen sind privat? ──────────────────────────────────────
//
// Nur die freigegebenen zählen: Wer gesperrt ist oder noch wartet,
// steht in keiner Ligatabelle und hat dort nichts zu verbergen.
//
// `COALESCE(zahlen_privat, admin)` ist die Vorgabe — siehe Schema.
export async function geheimeZugaenge() {
  await schema();
  return await sql`
    SELECT kennung, name, kb_uid, COALESCE(zahlen_privat, admin) AS zahlen_privat
      FROM zugang
     WHERE status = ${FREI} AND COALESCE(zahlen_privat, admin)`;
}

// Der Schalter. Ab jetzt steht dort eine Entscheidung, keine Vorgabe.
export async function setzePrivat(kennung, privat) {
  await schema();
  const ziel = kennungAus(kennung);
  if (!ziel) return { fehler: "unbekannte Kennung" };
  await sql`UPDATE zugang SET zahlen_privat = ${!!privat} WHERE kennung = ${ziel}`;
  return { ok: true };
}
