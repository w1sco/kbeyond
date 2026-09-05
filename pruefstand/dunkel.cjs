// Prüft jede Seite in BEIDEN Themen: Kontrast von Text zu seinem eigenen
// Grund, und im Dunkelmodus zusätzlich, ob irgendwo eine helle Fläche
// stehen geblieben ist.
//
// Und zwar in ZWEI Zuständen. Die erste Fassung sah nur den Ruhezustand
// und hat deshalb eine gewählte Kaderzeile nie zu Gesicht bekommen: Ihre
// helle Fläche entsteht erst durch einen Klick. Live stand danach heller
// Text auf hellem Indigo — Kontrast 1,05:1, also unlesbar.
//
// Beide Themen, weil die Messung sonst wieder die Hälfte verpasst: Die
// getönten Flächen (gewählte Zeile, Warnung, Erfolg) sind im HELLEN Modus
// die kritischen — dort lag das Rot bei 3,9:1.
const { chromium } = require("playwright-core");
const LIGA = "1";
const SEITEN = [
  ["Ligaauswahl", "/liga"], ["Ligaseite", `/liga?league=${LIGA}`],
  ["Managerseite", `/liga/manager/1?league=${LIGA}`],
  ["Live-Punkte", `/liga/live?league=${LIGA}`],
  ["Freie Spieler", `/liga/markt?league=${LIGA}`],
  ["Transfermarkt", `/liga/transfermarkt?league=${LIGA}`],
  ["Aufschläge", `/liga/aufschlaege?league=${LIGA}`],
  ["Gegner", `/liga/gegner?league=${LIGA}`],
  ["News", `/liga/news?league=${LIGA}`],
  ["Einstellungen", `/liga/einstellungen?league=${LIGA}`],
  ["Alter Markt", `/markt?league=${LIGA}`],
  ["Live-Diagnose", `/livepunkte?league=${LIGA}`],
  ["Marktwert-Diag.", `/marktwert?league=${LIGA}`],
  ["Startelf-Diag.", `/startelf?league=${LIGA}`],
  ["Aufstellung-Diag.", `/aufstellung?league=${LIGA}`],
  ["Feed-Diagnose", `/feed?league=${LIGA}`],
  ["Rekonstruiert", `/rk?league=${LIGA}`],
  ["Login", "/login"],
];

// Alles, was seinen Grund erst auf Klick ändert. Je Seite werden die
// ersten Treffer angeklickt und danach wird erneut gemessen.
const KLICKBAR = [".kb-klickzeile", ".kb-chip", ".kb-sortchip", ".kb-aufklapp"];

function leuchte(c) {
  const [r,g,b] = c.map(v => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; });
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
function kontrast(a, b) {
  const l1 = leuchte(a), l2 = leuchte(b);
  return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
}
const rgb = (s) => (s.match(/[\d.]+/g) ?? [0,0,0]).slice(0,3).map(Number);

// Im Browser ausgeführt: sammelt helle Flächen und jeden sichtbaren
// Textknoten mit seinem tatsächlichen Grund.
function sammle() {
  const durchsichtig = (f) => f === "transparent" || /rgba\([^)]*,\s*0\)$/.test(f);
  // Der Grund eines Textes steht selten am Element selbst — durchsichtige
  // Flächen werden nach oben durchgereicht, bis eine deckende kommt.
  function grundVon(el) {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none") return null;   // Verlauf: nicht messbar
      if (!durchsichtig(cs.backgroundColor)) return cs.backgroundColor;
    }
    return getComputedStyle(document.body).backgroundColor;
  }

  const hell = [];
  const schwach = [];
  const gesehen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    // Das Spielfeld ist in beiden Themen grün – die weißen Spielerpunkte
    // darauf sind dort richtig und keine Fundstelle.
    if (el.closest(".kb-platz")) continue;
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);

    const bg = cs.backgroundColor;
    if (bg.startsWith("rgb")) {
      const [r,g,b] = (bg.match(/[\d.]+/g)??[]).slice(0,3).map(Number);
      const a = bg.startsWith("rgba") ? Number(bg.match(/[\d.]+\)$/)?.[0]?.slice(0,-1) ?? 1) : 1;
      if (a > 0.5 && r > 200 && g > 200 && b > 200) {
        hell.push(el.className?.toString?.().slice(0,40) || el.tagName);
      }
    }

    // Nur Elemente mit eigenem Text – sonst zählt derselbe Satz einmal je
    // Vorfahr.
    const eigen = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!eigen) continue;
    const grund = grundVon(el);
    if (!grund) continue;
    const marke = `${cs.color}|${grund}|${el.className}`;
    if (gesehen.has(marke)) continue;
    gesehen.add(marke);
    // Großer Text darf auf 3:1 – so steht es in WCAG.
    const gross = parseFloat(cs.fontSize) >= 24 ||
                  (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
    schwach.push({
      text: (el.textContent ?? "").trim().slice(0, 24),
      klasse: el.className?.toString?.().slice(0,40) || el.tagName,
      farbe: cs.color, grund, soll: gross ? 3 : 4.5,
    });
  }
  return { hell: [...new Set(hell)].slice(0,4), texte: schwach };
}

function unterKontrast(m) {
  return m.texte
    .map(t => ({...t, k: kontrast(rgb(t.farbe), rgb(t.grund))}))
    .filter(t => t.k < t.soll)
    .sort((a,b) => a.k - b.k)
    .slice(0, 4);
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox"] });
  let schlecht = 0;
  for (const thema of ["dark", "light"]) {
  const dunkel = thema === "dark";
  const ctx = await b.newContext({ viewport:{width:1400,height:950}, colorScheme: thema });
  await ctx.addCookies([
    {name:"kb_token",value:"pruef",domain:"localhost",path:"/"},
    {name:"kb_uid",value:"1",domain:"localhost",path:"/"},
  ]);
  console.log(dunkel ? "— Dunkelmodus —" : "\n— Hellmodus —");
  for (const [name, url] of SEITEN) {
    const p = await ctx.newPage();
    const fehler = [];
    p.on("pageerror", e => fehler.push(e.message));
    const res = await p.goto("http://localhost:3300"+url, {waitUntil:"networkidle"});

    let m = await p.evaluate(sammle);
    let zustand = "";

    // Zweiter Durchgang: anklicken, was seinen Grund ändert. Der Zeiger
    // wird danach weggefahren – sonst überdeckt die Hover-Regel genau die
    // Fläche, um die es geht.
    let geklickt = 0;
    for (const wahl of KLICKBAR) {
      const treffer = await p.locator(wahl).all();
      for (const t of treffer.slice(0, 2)) {
        try { await t.click({ timeout: 1500 }); geklickt++; } catch { /* verdeckt oder gesperrt */ }
      }
    }
    if (geklickt) {
      await p.mouse.move(0, 0);
      await p.waitForTimeout(150);
      const n = await p.evaluate(sammle);
      if (n.hell.length > m.hell.length || unterKontrast(n).length > unterKontrast(m).length) {
        m = n;
        zustand = ` (nach ${geklickt} Klicks)`;
      }
    }

    // Eine helle Fläche ist nur im Dunkelmodus eine Fundstelle – im
    // hellen ist sie das Thema.
    const hell = dunkel ? m.hell : [];
    const duenn = unterKontrast(m);
    const ok = res.status() === 200 && hell.length === 0 && duenn.length === 0 && fehler.length === 0;
    if (!ok) schlecht++;
    console.log(`${ok?"✓":"✗"} ${name.padEnd(18)} HTTP ${res.status()}  ${m.texte.length} Textstellen${zustand}` +
      (hell.length ? `  HELLE FLÄCHEN: ${hell.join(", ")}` : "") +
      (fehler.length ? `  FEHLER: ${fehler[0]}` : ""));
    for (const t of duenn) {
      console.log(`    ${t.k.toFixed(2)}:1 (soll ${t.soll})  ${t.farbe} auf ${t.grund}  .${t.klasse}  „${t.text}"`);
    }
    await p.close();
  }
  await ctx.close();
  }
  // Und der Umschalter: ausdrückliche Wahl muss die Systemeinstellung
  // stechen, in beide Richtungen.
  const uctx = await b.newContext({ viewport:{width:1400,height:950}, colorScheme: "dark" });
  await uctx.addCookies([
    {name:"kb_token",value:"pruef",domain:"localhost",path:"/"},
    {name:"kb_uid",value:"1",domain:"localhost",path:"/"},
  ]);
  const p = await uctx.newPage();
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

  console.log(schlecht ? `\n${schlecht} Problem(e)`
    : "\nAlle Seiten in beiden Themen lesbar, auch im geklickten Zustand.");
  await b.close();
  process.exit(schlecht ? 1 : 0);
})();
