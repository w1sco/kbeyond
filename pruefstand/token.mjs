import { tokenAblauf } from "../lib/kickbase.js";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (nutzlast) => `hdr.${b64(nutzlast)}.sig`;
const s = (ms) => Math.floor(ms / 1000);
const TAG = 86400_000;

const faelle = [
  ["gültiges JWT, 30 Tage",     jwt({ exp: s(Date.now() + 30 * TAG) }), "Datum in ~30 Tagen"],
  ["gültiges JWT, 1 Tag",       jwt({ exp: s(Date.now() + TAG) }),      "Datum morgen"],
  ["abgelaufen",                jwt({ exp: s(Date.now() - TAG) }),      null],
  ["exp in Millisekunden",      jwt({ exp: Date.now() + 30 * TAG }),    null],
  ["exp fehlt",                 jwt({ sub: "x" }),                      null],
  ["exp ist Text",              jwt({ exp: "morgen" }),                 null],
  ["kein JWT",                  "abc123",                               null],
  ["leer",                      "",                                     null],
  ["null",                      null,                                   null],
  ["kaputte Nutzlast",          "hdr.!!!nichtbase64!!!.sig",            null],
  ["JWT ohne Signaturteil",     `hdr.${b64({ exp: s(Date.now() + TAG) })}`, null],
];

let fehler = 0;
for (const [name, token, erwartet] of faelle) {
  const r = tokenAblauf(token);
  const ok = erwartet === null ? r === null : r instanceof Date;
  if (!ok) fehler++;
  const zeigt = r === null ? "null" : `${r.toISOString().slice(0, 16)} (in ${Math.round((r - Date.now()) / TAG)} Tagen)`;
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(24)} → ${zeigt}`);
}
console.log(fehler ? `\n${fehler} Fall/Fälle falsch` : "\nAlle Fälle richtig.");
process.exit(fehler ? 1 : 0);
