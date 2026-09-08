// Kommt ein Fremder herein?
//
// Das ist keine Rechnung, sondern eine Zusage — deshalb wird sie gegen den
// laufenden Server geprüft, nicht gegen eine Funktion. Ein Fehler hier ist
// nicht „eine Zahl stimmt nicht", sondern „jeder darf mit".
import pg from "pg";
import { createHash } from "crypto";
import { existsSync, readFileSync, rmSync } from "fs";

const BASIS = `http://localhost:${process.argv[2] ?? 3300}`;
const finger = (t) => createHash("sha256").update(t).digest("hex");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ??
  "postgres://postgres@localhost:5433/postgres" });

let ok = 0, fehler = 0;
const pruefe = (name, ist, soll) => {
  if (JSON.stringify(ist) === JSON.stringify(soll)) ok++;
  else { fehler++; console.log(`✗ ${name}\n    ist:  ${JSON.stringify(ist)}\n    soll: ${JSON.stringify(soll)}`); }
};

// Ohne Weiterleitung folgen: der Status ist die Aussage.
async function seite(pfad, token) {
  const res = await fetch(BASIS + pfad, {
    redirect: "manual",
    headers: token ? { cookie: `kb_token=${token}; kb_uid=1` } : {},
  });
  return { status: res.status, ziel: res.headers.get("location") ?? "" };
}

async function anmelden(email) {
  const res = await fetch(`${BASIS}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: BASIS },
    body: JSON.stringify({ email, password: "egal" }),
  });
  return {
    status: res.status,
    koerper: await res.json().catch(() => ({})),
    // Der wichtigste Teil: Ohne Freigabe darf **kein** Cookie gesetzt werden.
    cookie: res.headers.get("set-cookie") ?? "",
  };
}

await db.connect();
const weg = async () => {
  await db.query(`DELETE FROM zugang_sitzung WHERE kennung LIKE '%@pruefzugang.test'`);
  await db.query(`DELETE FROM zugang WHERE kennung LIKE '%@pruefzugang.test'`);
};
await weg();
try { rmSync("/tmp/pruefstand-mail.log"); } catch { /* war nicht da */ }

// ── 1. Ohne Sitzung kommt niemand herein ───────────────────────────
for (const pfad of ["/liga", "/liga?league=1", "/liga/markt?league=1", "/zugang"]) {
  const r = await seite(pfad, null);
  pruefe(`ohne Token: ${pfad}`, [r.status, r.ziel.includes("/login")], [307, true]);
}

// ── 2. Ein gültiges Kickbase-Token allein reicht nicht ─────────────
//
// Der Kern der Sache: Wer sich bei Kickbase anmelden kann, hat noch lange
// keinen Zugang zu dieser App.
for (const pfad of ["/liga", "/liga?league=1", "/zugang"]) {
  const r = await seite(pfad, "fremdes-token");
  pruefe(`fremdes Token: ${pfad}`, [r.status, r.ziel.includes("/login")], [307, true]);
}

// ── 3. Die erste Anmeldung ist eine Anfrage, keine Sitzung ─────────
const neu = await anmelden("neu@pruefzugang.test");
pruefe("neue Anmeldung: abgelehnt", neu.status, 403);
pruefe("neue Anmeldung: als Anfrage vermerkt", neu.koerper.zugang, "offen");
pruefe("neue Anmeldung: KEIN Cookie", neu.cookie.includes("kb_token"), false);

const [{ status: standNeu }] = (await db.query(
  `SELECT status FROM zugang WHERE kennung = 'neu@pruefzugang.test'`)).rows;
pruefe("Anfrage steht in der Liste", standNeu, "offen");

// Groß- und Kleinschreibung dürfen keine zweite Anfrage erzeugen.
await anmelden("NEU@PruefZugang.test");
const [{ n: anzahl }] = (await db.query(
  `SELECT COUNT(*)::int AS n FROM zugang WHERE kennung LIKE '%@pruefzugang.test'`)).rows;
pruefe("dieselbe Adresse, eine Zeile", anzahl, 1);
const [{ versuche }] = (await db.query(
  `SELECT versuche FROM zugang WHERE kennung = 'neu@pruefzugang.test'`)).rows;
pruefe("beide Versuche gezählt", versuche, 2);

// ── 3b. Die Anfrage erreicht den Betreiber ─────────────────────────
//
// Nur wenn der Versand eingerichtet ist — sonst prüft dieser Abschnitt
// nichts und sagt das auch.
const MAIL_LOG = "/tmp/pruefstand-mail.log";
const posten = () => existsSync(MAIL_LOG)
  ? readFileSync(MAIL_LOG, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  : [];

if (process.env.RESEND_API_KEY) {
  const raus = posten().filter((m) => String(m.betreff).includes("neu@pruefzugang.test"));
  pruefe("neue Anfrage löst genau eine Nachricht aus", raus.length, 1);
  pruefe("Nachricht geht an den Betreiber", raus[0]?.an, [process.env.ZUGANG_MAIL_AN]);

  const [{ gemeldet, melde_fehler: mf }] = (await db.query(
    `SELECT gemeldet, melde_fehler FROM zugang WHERE kennung = 'neu@pruefzugang.test'`)).rows;
  if (process.env.KB_MAIL_FEHLER === "1") {
    pruefe("Fehlschlag wird vermerkt", [gemeldet, Boolean(mf)], [null, true]);
  } else {
    pruefe("Erfolg wird vermerkt", [Boolean(gemeldet), mf], [true, null]);
  }
} else {
  console.log("  (Mailversand nicht eingerichtet — Abschnitt übersprungen)");
}

// ── 4. Nach der Freigabe geht es ───────────────────────────────────
await db.query(`UPDATE zugang SET status = 'frei' WHERE kennung = 'neu@pruefzugang.test'`);
const frei = await anmelden("neu@pruefzugang.test");
pruefe("nach Freigabe: angemeldet", [frei.status, frei.koerper.ok], [200, true]);
pruefe("nach Freigabe: Cookie gesetzt", frei.cookie.includes("kb_token"), true);

// ── 5. Eine Sperre wirkt sofort, nicht erst beim Ablauf ────────────
const token = "gesperrt-gleich";
await db.query(
  `INSERT INTO zugang_sitzung (finger, kennung) VALUES ($1, 'neu@pruefzugang.test')
   ON CONFLICT (finger) DO NOTHING`, [finger(token)]);
pruefe("freigegeben: Seite lädt", (await seite("/liga?league=1", token)).status, 200);

await db.query(`UPDATE zugang SET status = 'gesperrt' WHERE kennung = 'neu@pruefzugang.test'`);
await db.query(`DELETE FROM zugang_sitzung WHERE kennung = 'neu@pruefzugang.test'`);
const nachher = await seite("/liga?league=1", token);
pruefe("gesperrt: sofort draußen", [nachher.status, nachher.ziel.includes("/login")], [307, true]);

const gesperrt = await anmelden("neu@pruefzugang.test");
pruefe("gesperrt: Anmeldung sagt es", [gesperrt.status, gesperrt.koerper.zugang], [403, "gesperrt"]);
pruefe("gesperrt: kein Cookie", gesperrt.cookie.includes("kb_token"), false);

// ── 6. Freigegeben heißt nicht Betreiber ───────────────────────────
await db.query(`UPDATE zugang SET status = 'frei' WHERE kennung = 'neu@pruefzugang.test'`);
await db.query(
  `INSERT INTO zugang_sitzung (finger, kennung) VALUES ($1, 'neu@pruefzugang.test')
   ON CONFLICT (finger) DO NOTHING`, [finger(token)]);
const verwaltung = await seite("/zugang", token);
pruefe("kein Betreiber: /zugang ist zu",
  [verwaltung.status, verwaltung.ziel.includes("/liga")], [307, true]);
pruefe("kein Betreiber: die Liga bleibt offen",
  (await seite("/liga?league=1", token)).status, 200);

await weg();
await db.end();
console.log(fehler ? `\n${ok} ok, ${fehler} Fehler` : `\n${ok} ok, 0 Fehler`);
process.exit(fehler ? 1 : 0);
