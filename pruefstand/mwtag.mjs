// Der Marktwert-Tag: Grenze 22:04 deutscher Zeit, nicht Mitternacht.
import { mwTag, letztesMwUpdate, MW_UHRZEIT } from "../lib/format.js";

// Eingabe als deutsche Ortszeit, ausgedrückt über den bekannten UTC-Versatz
const berlin = (iso, versatzStd) => new Date(Date.parse(`${iso}Z`) - versatzStd * 3600_000);

const faelle = [
  // Sommerzeit (UTC+2)
  ["27.08. 21:00 → Vortag",      berlin("2026-08-27T21:00:00", 2), "2026-08-26"],
  ["27.08. 22:03 → Vortag",      berlin("2026-08-27T22:03:00", 2), "2026-08-26"],
  ["27.08. 22:04 → selber Tag",  berlin("2026-08-27T22:04:00", 2), "2026-08-27"],
  ["27.08. 23:30 → selber Tag",  berlin("2026-08-27T23:30:00", 2), "2026-08-27"],
  ["28.08. 00:30 → Vortag",      berlin("2026-08-28T00:30:00", 2), "2026-08-27"],
  ["28.08. 10:00 → Vortag",      berlin("2026-08-28T10:00:00", 2), "2026-08-27"],
  // Monatswechsel
  ["01.09. 10:00 → 31.08.",      berlin("2026-09-01T10:00:00", 2), "2026-08-31"],
  // Jahreswechsel, Winterzeit (UTC+1)
  ["01.01. 08:00 → 31.12.",      berlin("2026-01-01T08:00:00", 1), "2025-12-31"],
  // Zeitumstellung: Nacht der Vorstellung (29.03.2026)
  ["29.03. 10:00 → 28.03.",      berlin("2026-03-29T10:00:00", 2), "2026-03-28"],
  ["29.03. 23:00 → selber Tag",  berlin("2026-03-29T23:00:00", 2), "2026-03-29"],
  // Zeitumstellung: Nacht der Rückstellung (25.10.2026)
  ["25.10. 10:00 → 24.10.",      berlin("2026-10-25T10:00:00", 1), "2026-10-24"],
  ["26.10. 23:00 → selber Tag",  berlin("2026-10-26T23:00:00", 1), "2026-10-26"],
  ["leer",                       null,                             null],
];

let fehler = 0;
for (const [name, d, erwartet] of faelle) {
  const r = mwTag(d);
  const ok = r === erwartet;
  if (!ok) fehler++;
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(28)} → ${r}${ok ? "" : `  (erwartet ${erwartet})`}`);
}

// letztesMwUpdate muss immer in der Vergangenheit liegen und höchstens 24 h her sein
console.log("\n  letztesMwUpdate über 48 Stichproben eines Jahres:");
let schlecht = 0;
for (let i = 0; i < 48; i++) {
  const jetzt = new Date(Date.UTC(2026, 0, 1) + i * 7.6 * 86400_000 + i * 1811_000);
  const u = letztesMwUpdate(jetzt);
  const her = (jetzt - u) / 3600_000;
  if (!(her >= 0 && her < 24.5)) { schlecht++; console.log(`    ✗ ${jetzt.toISOString()} → ${u?.toISOString()} (${her.toFixed(1)} h her)`); }
}
console.log(schlecht ? `    ${schlecht} Ausreißer` : `    ✓ alle zwischen 0 und 24 h her, Grenze ${MW_UHRZEIT}`);

process.exit(fehler + schlecht ? 1 : 0);
