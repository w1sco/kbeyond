// Prüft jede Seite im Dunkelmodus: Kontrast von Text zu Hintergrund und
// ob irgendwo eine helle Fläche stehen geblieben ist.
const { chromium } = require("playwright-core");
const LIGA = "1";
const SEITEN = [
  ["Ligaauswahl", "/liga"], ["Ligaseite", `/liga?league=${LIGA}`],
  ["Managerseite", `/liga/manager/1?league=${LIGA}`],
  ["Live-Punkte", `/liga/live?league=${LIGA}`],
  ["Freie Spieler", `/liga/markt?league=${LIGA}`],
  ["Transfermarkt", `/liga/transfermarkt?league=${LIGA}`],
  ["Aufschläge", `/liga/aufschlaege?league=${LIGA}`],
  ["News", `/liga/news?league=${LIGA}`],
  ["Einstellungen", `/liga/einstellungen?league=${LIGA}`],
  ["Alter Markt", `/markt?league=${LIGA}`],
  ["Live-Diagnose", `/livepunkte?league=${LIGA}`],
  ["Marktwert-Diag.", `/marktwert?league=${LIGA}`],
  ["Aufstellung-Diag.", `/aufstellung?league=${LIGA}`],
  ["Feed-Diagnose", `/feed?league=${LIGA}`],
  ["Rekonstruiert", `/rk?league=${LIGA}`],
  ["Login", "/login"],
];

function leuchte(c) {
  const [r,g,b] = c.map(v => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; });
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
function kontrast(a, b) {
  const l1 = leuchte(a), l2 = leuchte(b);
  return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
}
const rgb = (s) => (s.match(/\d+/g) ?? [0,0,0]).slice(0,3).map(Number);

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox"] });
  const ctx = await b.newContext({
    viewport:{width:1400,height:950},
    colorScheme: "dark",           // System steht auf dunkel
  });
  await ctx.addCookies([
    {name:"kb_token",value:"pruef",domain:"localhost",path:"/"},
    {name:"kb_uid",value:"1",domain:"localhost",path:"/"},
  ]);
  let schlecht = 0;
  for (const [name, url] of SEITEN) {
    const p = await ctx.newPage();
    const fehler = [];
    p.on("pageerror", e => fehler.push(e.message));
    const res = await p.goto("http://localhost:3300"+url, {waitUntil:"networkidle"});
    const m = await p.evaluate(() => {
      const hell = [];
      // Jede sichtbare Fläche einsammeln, die hell geblieben ist
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundColor;
        if (!bg.startsWith("rgb")) continue;
        const [r,g,bl] = (bg.match(/\d+/g)??[]).slice(0,3).map(Number);
        const a = bg.startsWith("rgba") ? Number(bg.match(/[\d.]+\)$/)?.[0]?.slice(0,-1) ?? 1) : 1;
        // Das Spielfeld ist in beiden Themen grün – die weißen
        // Spielerpunkte darauf sind dort richtig und keine Fundstelle.
        if (el.closest(".kb-platz")) continue;
        if (a > 0.5 && r > 200 && g > 200 && bl > 200 && el.getClientRects().length) {
          hell.push(el.className?.toString?.().slice(0,40) || el.tagName);
        }
      }
      const koerper = getComputedStyle(document.body);
      return { bg: koerper.backgroundColor, farbe: koerper.color, hell: [...new Set(hell)].slice(0,4) };
    });
    const k = kontrast(rgb(m.farbe), rgb(m.bg)).toFixed(1);
    const ok = res.status() === 200 && m.hell.length === 0 && k >= 7 && fehler.length === 0;
    if (!ok) schlecht++;
    console.log(`${ok?"✓":"✗"} ${name.padEnd(18)} HTTP ${res.status()}  Kontrast ${k}:1` +
      (m.hell.length ? `  HELLE FLÄCHEN: ${m.hell.join(", ")}` : "") +
      (fehler.length ? `  FEHLER: ${fehler[0]}` : ""));
    await p.close();
  }
  // Und der Umschalter: ausdrückliche Wahl muss die Systemeinstellung
  // stechen, in beide Richtungen.
  const p = await ctx.newPage();
  await p.goto("http://localhost:3300/liga?league=1", {waitUntil:"networkidle"});
  const vorher = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.click(".kb-thema");
  await p.waitForTimeout(150);
  const nachKlick = await p.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    attr: document.documentElement.dataset.theme,
    gemerkt: localStorage.getItem("kb-thema"),
  }));
  // Neu laden: die Wahl muss halten und darf nicht aufblitzen
  await p.reload({waitUntil:"networkidle"});
  const nachLaden = await p.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    attr: document.documentElement.dataset.theme,
  }));
  const hellGeworden = nachKlick.bg !== vorher && nachKlick.attr === "light";
  const haelt = nachLaden.attr === "light" && nachLaden.bg === nachKlick.bg;
  console.log(`\n${hellGeworden?"✓":"✗"} Klick auf dunklem System schaltet auf hell (${vorher} → ${nachKlick.bg})`);
  console.log(`${haelt?"✓":"✗"} Wahl hält nach dem Neuladen (gemerkt: ${nachKlick.gemerkt})`);
  if (!hellGeworden || !haelt) schlecht++;

  console.log(schlecht ? `\n${schlecht} Problem(e)` : "\nAlle Seiten dunkel und lesbar, Umschalter greift.");
  await b.close();
  process.exit(schlecht ? 1 : 0);
})();
