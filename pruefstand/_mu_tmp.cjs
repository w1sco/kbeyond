const { chromium } = require("playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true });
  await ctx.addCookies([{ name: "kb_token", value: "pruef", domain: "localhost", path: "/" },
                        { name: "kb_uid", value: "1", domain: "localhost", path: "/" }]);
  const p = await ctx.newPage();
  const fehler = [];
  let anfragen = 0;
  p.on("pageerror", (e) => fehler.push(e.message));
  p.on("request", (r) => { if (r.url().includes("/liga/")) anfragen++; });
  await p.goto("http://localhost:3301/liga/matchup?league=1", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  console.log("nach Seitenaufruf, Anfragen an /liga/:", anfragen);
  for (const [gruppe, text] of [["Ansicht", "Leichtes Programm"], ["Position", "ABW"], ["Maß", "je Mannschaft"]]) {
    anfragen = 0;
    await p.locator(`[aria-label="${gruppe}"] a`, { hasText: text }).click();
    await p.waitForLoadState("networkidle"); await p.waitForTimeout(1500);
    const ok = await p.locator(`[aria-label="${gruppe}"] [aria-current]`).innerText().catch(() => "?");
    console.log(`Klick ${gruppe}=${text}: ${anfragen} Anfragen, aktiv: ${ok}`);
  }
  console.log("Fehler:", fehler.length ? fehler : "keine");
  await b.close();
})();
