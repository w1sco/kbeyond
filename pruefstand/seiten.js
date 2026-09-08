// Ruft jede Seite auf und prüft, ob sie wirklich rendert.
//
// Der Build sagt nur, ob der Code übersetzt. Diese Prüfung sagt, ob die
// Seite läuft — mit echtem Postgres darunter und abgeklemmtem Kickbase.
const { chromium } = require("playwright-core");

const LIGA = "1";
const SEITEN = [
  ["Ligaauswahl",        "/liga"],
  ["Ligaseite",          `/liga?league=${LIGA}`],
  ["Aufschläge",         `/liga/aufschlaege?league=${LIGA}`],
  ["Aufschläge Filter",  `/liga/aufschlaege?league=${LIGA}&auf=7&her=alle`],
  ["Managerseite",       `/liga/manager/1?league=${LIGA}`],
  ["Managerseite fremd", `/liga/manager/2?league=${LIGA}`],
  ["Freie Spieler",      `/liga/markt?league=${LIGA}`],
  ["Freie Spieler Filter", `/liga/markt?league=${LIGA}&min=10000000`],
  ["Transfermarkt",      `/liga/transfermarkt?league=${LIGA}`],
  ["News",               `/liga/news?league=${LIGA}`],
  ["Live-Punkte",        `/liga/live?league=${LIGA}`],
  ["Live-Diagnose",      `/livepunkte?league=${LIGA}`],
  ["Live-Diagnose Suche", `/livepunkte?league=${LIGA}&suchen=1`],
  ["Spielplan-Diagnose", `/spielplan?league=${LIGA}`],
  ["Spielplan Suche",    `/spielplan?league=${LIGA}&suchen=1`],
  ["Startelf-Diagnose", `/startelf?league=${LIGA}`],
  ["Startelf Suche",    `/startelf?league=${LIGA}&suchen=1`],
  ["Einstellungen",      `/liga/einstellungen?league=${LIGA}`],
  ["Zugang",             "/zugang"],
  ["Marktwert-Diagnose", `/marktwert?league=${LIGA}`],
  ["Endpunkt-Vergleich", `/ligamonitor?league=${LIGA}`],
  ["Aufstellung-Diagnose", `/aufstellung?league=${LIGA}`],
  ["Feed-Diagnose",      `/feed?league=${LIGA}`],
  ["Ranking-Diagnose",   `/ranking?league=${LIGA}`],
  ["Rekonstruiert",      `/rk?league=${LIGA}`],
  ["Login-Bonus",        `/bonus?league=${LIGA}`],
  ["Transfers nach Name", `/manager-detail?league=${LIGA}`],
  ["Login",              "/login"],
  ["Login abgelaufen",   "/login?abgelaufen=1"],
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
    // Auch Konsolenfehler zählen. React meldet ungültiges HTML und
    // Hydrierungskonflikte über console.error, nicht als Ausnahme — ein
    // <dialog> in einem <p> blieb deshalb lange unbemerkt.
    p.on("console", (m) => {
      if (m.type() === "error") konsole.push(m.text().split("\n")[0]);
    });
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

      // Eine Aktion, die man nicht findet, gibt es nicht.
      //
      // Der Seitenüberlauf oben reicht dafür nicht: Auf /zugang lagen
      // „Freigeben" und „Ablehnen" 120 px rechts neben dem Bildschirm —
      // **innerhalb** eines Rahmens, der sauber für sich scrollt. Die
      // Seite war damit formal in Ordnung und die Entscheidung trotzdem
      // unerreichbar. Der Nutzer hat es gemeldet, nicht der Prüfstand.
      //
      // Geprüft werden nur Knöpfe in einem Formular: Die schicken etwas
      // ab. Sortierüberschriften in einer scrollenden Tabelle sind etwas
      // anderes — die Tabelle scrollt dort mit Absicht.
      const versteckt = await p.evaluate(() =>
        [...document.querySelectorAll("form button, form input[type=submit]")]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ text: (el.textContent || el.value || "?").trim().slice(0, 20),
                          rechts: Math.round(el.getBoundingClientRect().right) }))
          .filter((k) => k.rechts > innerWidth));

      const unerreichbar = versteckt.length > 0;
      console.log(
        `  ${kaputt || unerreichbar ? "✗" : "✓"} ${name.padEnd(22)} HTTP ${status}` +
        (ueberlauf > 0 ? `  Überlauf +${ueberlauf}` : "") +
        (unerreichbar
          ? `  außer Reichweite: ${versteckt.map((k) => `„${k.text}" bei ${k.rechts}px`).join(", ")}`
          : "") +
        (konsole.length ? `  ${konsole[0].slice(0, 90)}` : "") +
        (kaputt && !konsole.length ? `  ${text.replace(/\n/g, " ").slice(0, 90)}` : "")
      );
      if (kaputt || unerreichbar) fehler++;
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
