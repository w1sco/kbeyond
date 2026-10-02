// Wie viele Anfragen löst ein Klick auf einen Filter aus?
//
// Läuft gegen einen FERTIGEN Build (`next build && next start`), nicht gegen
// den Entwicklungsserver: Next.js lädt verlinkte Seiten nur im fertigen Build
// vor. Der übrige Prüfstand läuft im Entwicklungsmodus und hat das deshalb
// nie gesehen — live lösten die Filter der Matchup-Seite je Klick rund 20
// Hintergrund-Abrufe aus, darunter einen der Seite ganz ohne Liga in der
// Adresse, und die Seite stürzte ab („Liga fehlt“, „This page couldn't load“).
//
// Aufruf: node pruefstand/vorladen.cjs 3301
// Rückgabewert 1, sobald ein Klick mehr als zwei Anfragen auslöst.
const { chromium } = require("playwright-core");

const port = process.argv[2] ?? "3301";
const basis = `http://localhost:${port}`;

const SEITEN = [
  ["/liga/matchup?league=1", [["Ansicht", "Leichtes Programm"], ["Position", "ABW"], ["Maß", "je Mannschaft"]]],
];

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true });
  await ctx.addCookies([{ name: "kb_token", value: "pruef", domain: "localhost", path: "/" },
                        { name: "kb_uid", value: "1", domain: "localhost", path: "/" }]);
  let fehler = 0;
  for (const [pfad, klicks] of SEITEN) {
    const p = await ctx.newPage();
    const abstuerze = [];
    let anfragen = 0;
    p.on("pageerror", (e) => abstuerze.push(e.message));
    p.on("request", (r) => { if (r.url().startsWith(basis + "/liga")) anfragen++; });
    await p.goto(basis + pfad, { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    const imRuhe = anfragen - 1;
    console.log(`  ${imRuhe > 0 ? "✗" : "✓"} ${pfad}: ${imRuhe} Hintergrund-Abrufe nach dem Laden`);
    if (imRuhe > 0) fehler++;
    for (const [gruppe, text] of klicks) {
      anfragen = 0;
      await p.locator(`[aria-label="${gruppe}"] a`, { hasText: text }).click();
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(1500);
      const aktiv = await p.locator(`[aria-label="${gruppe}"] [aria-current]`).innerText().catch(() => "");
      const gut = anfragen <= 2 && aktiv.includes(text);
      console.log(`  ${gut ? "✓" : "✗"} Klick ${gruppe} = ${text}: ${anfragen} Anfragen${aktiv.includes(text) ? "" : ", Filter nicht übernommen"}`);
      if (!gut) fehler++;
    }
    if (abstuerze.length) { console.log("  ✗ Absturz:", abstuerze); fehler++; }
    await p.close();
  }
  await b.close();
  console.log(fehler ? `\n${fehler} Fundstellen.` : "\nKein Vorladen, kein Absturz.");
  process.exit(fehler ? 1 : 0);
})();
