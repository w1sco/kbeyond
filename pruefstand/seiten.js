// Ruft jede Seite auf und prüft, ob sie wirklich rendert.
//
// Der Build sagt nur, ob der Code übersetzt. Diese Prüfung sagt, ob die
// Seite läuft — mit echtem Postgres darunter und abgeklemmtem Kickbase.
const { chromium } = require("playwright-core");

const LIGA = "1";
const SEITEN = [
  ["Ligaauswahl",        "/liga"],
  ["Ligaseite",          `/liga?league=${LIGA}`],
  ["Ligaseite Aufschlag", `/liga?league=${LIGA}&auf=7&her=alle`],
  ["Managerseite",       `/liga/manager/1?league=${LIGA}`],
  ["Managerseite fremd", `/liga/manager/2?league=${LIGA}`],
  ["Freie Spieler",      `/liga/markt?league=${LIGA}`],
  ["Freie Spieler Filter", `/liga/markt?league=${LIGA}&min=10000000`],
  ["Transfermarkt",      `/liga/transfermarkt?league=${LIGA}`],
  ["Einstellungen",      `/liga/einstellungen?league=${LIGA}`],
  ["Marktwert-Diagnose", `/marktwert?league=${LIGA}`],
  ["Feed-Diagnose",      `/feed?league=${LIGA}`],
  ["Ranking-Diagnose",   `/ranking?league=${LIGA}`],
  ["Rekonstruiert",      `/rk?league=${LIGA}`],
  ["Login-Bonus",        `/bonus?league=${LIGA}`],
  ["Transfers nach Name", `/manager-detail?league=${LIGA}`],
  ["Login",              "/login"],
];

(async () => {
  const port = process.argv[2] ?? "3300";
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true });
  await ctx.addCookies([
    { name: "kb_token", value: "pruef", domain: "localhost", path: "/" },
    { name: "kb_uid", value: "1", domain: "localhost", path: "/" },
  ]);

  let fehler = 0;

  // Der Aktualisieren-Lauf gehört mit geprüft: Er hat schon zweimal einen
  // Fehler geworfen, den keine Seitenansicht gezeigt hätte.
  const lauf = await ctx.request.post(
    `http://localhost:${port}/api/aktualisieren?league=${LIGA}`,
    { headers: { Origin: `http://localhost:${port}` } }
  );
  const lauftext = await lauf.text();
  const laufKaputt = lauf.status() >= 400 || /"error"/.test(lauftext);
  console.log(`  ${laufKaputt ? "✗" : "✓"} ${"Alles aktualisieren".padEnd(22)} HTTP ${lauf.status()}  ${lauftext.slice(0, 120)}`);
  if (laufKaputt) fehler++;

  for (const [name, pfad] of SEITEN) {
    const p = await ctx.newPage();
    const konsole = [];
    p.on("pageerror", (e) => konsole.push(e.message));
    let status = 0;
    try {
      const res = await p.goto(`http://localhost:${port}${pfad}`, { waitUntil: "networkidle", timeout: 25000 });
      status = res.status();
      const text = await p.evaluate(() => document.body.innerText.slice(0, 400));
      const kaputt = status >= 400 ||
        /server error|Unhandled|ReferenceError|TypeError|is not defined|Cannot read/i.test(text) ||
        konsole.length > 0;
      const ueberlauf = await p.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);

      console.log(
        `  ${kaputt ? "✗" : "✓"} ${name.padEnd(22)} HTTP ${status}` +
        (ueberlauf > 0 ? `  Überlauf +${ueberlauf}` : "") +
        (konsole.length ? `  ${konsole[0].slice(0, 90)}` : "") +
        (kaputt && !konsole.length ? `  ${text.replace(/\n/g, " ").slice(0, 90)}` : "")
      );
      if (kaputt) fehler++;
    } catch (e) {
      console.log(`  ✗ ${name.padEnd(22)} ${e.message.slice(0, 80)}`);
      fehler++;
    }
    await p.close();
  }

  await browser.close();
  console.log(`\n${fehler === 0 ? "Alle Seiten rendern." : fehler + " Seite(n) kaputt."}`);
  process.exit(fehler === 0 ? 0 : 1);
})();
