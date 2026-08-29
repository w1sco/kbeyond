// Kickbase-Attrappe für den Prüfstand.
//
// Wird über NODE_OPTIONS=--require beim Start des Servers geladen und
// fängt alle Aufrufe an api.kickbase.com ab. Der Produktionscode bleibt
// unangetastet — er merkt nichts davon.
//
// Zweck: Seiten mit echten Daten rendern, ohne einen einzigen echten
// Kickbase-Aufruf. Nach der Drosselung von heute Morgen ist das keine
// Bequemlichkeit, sondern Pflicht.

const LIGA = "1";

const MANAGER = [
  { i: 1, n: "W1zco",     sp: 0, tv: 180000000, spl: 1 },
  { i: 2, n: "yannick15", sp: 0, tv: 165000000, spl: 2 },
  { i: 3, n: "PetzS",     sp: 0, tv: 150000000, spl: 3 },
  // Der Admin. Mit KB_ADMIN_SPIELT=1 hat er eine Mannschaft und muss dann
  // überall als normaler Manager auftauchen.
  {
    i: 9,
    // Mit KB_ADMIN_DOPPELT=1 heißt der Admin wie ein Mitspieler – er darf
    // dessen Transfers dann nicht erben.
    n: process.env.KB_ADMIN_DOPPELT === "1" ? "PetzS" : "Der Admin",
    sp: 0, spl: 4, adm: true,
    tv: process.env.KB_ADMIN_SPIELT === "1" ? 142000000 : 0,
  },
];

// Marktangebote. `i` ist hier bewusst die ID des ANGEBOTS und `pi` die
// des Spielers — genau die Falle, in die das Projekt getappt ist: Wer `i`
// speichert, findet den Spieler nie im Kader wieder.
//
// Der Kader eines Managers enthält 201–206; 201 und 204 stehen hier am
// Markt, damit der „Markt"-Hinweis am Spieler geprüft wird.
const MARKT = [
  { i: "ang-1", pi: "101", fn: "Harry",  ln: "Kane",    mv: 68800000, prc: 68800000, exs: 42000, pos: 4, ap: 216, tp: 648, mvt: 1 },
  { i: "ang-2", pi: "102", fn: "Angelo", ln: "Stiller", mv: 36600000, prc: 36600000, exs: 38000, pos: 3, ap: 119, tp: 357, mvt: 0 },
  { i: "ang-3", pi: "201", fn: "Jonathan", ln: "Tah",   mv: 32200000, prc: 32200000, exs: 25000, pos: 2, ap: 96, tp: 288, mvt: 1 },
  { i: "ang-4", pi: "204", fn: "Ermedin", ln: "Demirovic", mv: 44200000, prc: 44200000, exs: 12000, pos: 4, ap: 133, tp: 401, mvt: 2 },
];

const KADER = {
  1: [
    { i: "201", mv: 32200000, prc: 30000000, pos: 2, tp: 288, mvgl: 2200000 },
    { i: "202", mv: 21900000, prc: 22700000, pos: 1, tp: 312, mvgl: -800000 },
    { i: "203", mv: 12500000, prc: 11000000, pos: 3, tp: 201, mvgl: 1500000 },
  ],
  2: [
    { i: "204", mv: 44200000, prc: 50000000, pos: 4, tp: 401, mvgl: -5800000 },
    { i: "205", mv:  8900000, prc:  7000000, pos: 1, tp: 150, mvgl: 1900000 },
  ],
  3: [{ i: "206", mv: 15100000, prc: 14000000, pos: 3, tp: 190, mvgl: 1100000 }],
};

const TEAMS = [7, 2, 3];
const VEREINSKADER = {
  7: [
    { i: "101", n: "Harry Kane", mv: 68800000, pos: 4 },
    { i: "201", n: "Jonathan Tah", mv: 32200000, pos: 2 },
    { i: "301", n: "Freier Stürmer", mv: 22000000, pos: 4 },
  ],
  2: [
    { i: "102", n: "Angelo Stiller", mv: 36600000, pos: 3 },
    { i: "302", n: "Freier Verteidiger", mv: 9000000, pos: 2 },
  ],
  3: [
    { i: "103", n: "Patrik Schick", mv: 29400000, pos: 4 },
    { i: "303", n: "Billiger Ersatz", mv: 400000, pos: 3 },
  ],
};

function antwort(daten, status = 200) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Ein Kader auf 18 Spieler aufgefüllt – erst ab zwölf greift die
// Felderkennung, und der Aufstellungs-Endpunkt soll dieselben Spieler
// nennen wie der Kader.
function vollerKader(uid) {
  const eigene = KADER[uid] ?? [];
  if (eigene.length === 0 || process.env.KB_ELF !== "1") return eigene;
  const voll = [...eigene];
  while (voll.length < 18) {
    const i = voll.length;
    voll.push({ i: `9${uid}${i}`, n: `Ersatz ${i}`, mv: 3_000_000 + i * 1000, pos: (i % 4) + 1 });
  }
  return voll;
}

function fuerPfad(pfad) {
  // Anmeldung: liefert ein echtes JWT mit Ablauf, damit sich prüfen lässt,
  // ob "angemeldet bleiben" die Cookie-Laufzeit wirklich aus dem Token
  // liest. Tage über KB_TOKEN_TAGE einstellbar, Vorgabe 30.
  if (pfad.includes("/user/login")) {
    const tage = Number(process.env.KB_TOKEN_TAGE ?? 30);
    const exp = Math.floor(Date.now() / 1000) + tage * 86400;
    const teil = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return {
      tkn: `${teil({ alg: "HS256" })}.${teil({ exp, sub: "1" })}.sig`,
      u: { i: "1", n: "W1zco" },
    };
  }

  if (pfad.includes("/leagues/selection")) {
    return { it: [{ i: Number(LIGA), n: "Prüfstand-Liga", b: 200000000, tv: 495000000 }] };
  }
  if (pfad.includes(`/leagues/${LIGA}/overview`)) {
    return { b: 200000000, dt: "2026-08-07T00:41:00Z", mgc: MANAGER.length };
  }
  if (pfad.includes(`/leagues/${LIGA}/me`)) return { b: 28448897 };
  if (pfad.includes(`/leagues/${LIGA}/ranking`)) {
    return { ti: "Prüfstand-Liga", us: MANAGER };
  }
  if (pfad.includes("/activitiesFeed")) {
    // Der Importer stoppt bei bekannten Events – leere Seite reicht
    return { af: [] };
  }
  if (pfad.includes(`/leagues/${LIGA}/market`)) return { it: MARKT };

  const dash = pfad.match(/\/managers\/(\d+)\/dashboard/);
  if (dash) {
    const eigene = KADER[dash[1]] ?? [];
    return { tv: eigene.reduce((s, x) => s + x.mv, 0), t: eigene.length * 3, prft: 0 };
  }

  // Der belegte Aufstellungs-Endpunkt. Antwortform wie live gesehen:
  // { it: [ { i, n, lo, st, lst, ... } ] }, `lo` ist die Position.
  // Mit KB_ELF=1 aktiv, sonst 404 – damit lässt sich beides prüfen.
  const lineup = pfad.match(new RegExp(`/leagues/${LIGA}/(?:managers/(\\d+)/)?lineup(?:\\?uid=(\\d+))?$`));
  if (lineup && process.env.KB_ELF === "1") {
    // Für wen? Aus dem Pfad, sonst der eigene Manager.
    // Mit KB_NUR_EIGENE=1 ignoriert der Endpunkt die uid und gibt immer
    // dieselbe Aufstellung zurück – der Lauf muss das erkennen.
    const wer = process.env.KB_NUR_EIGENE === "1" ? "1" : (lineup[1] ?? lineup[2] ?? "1");
    const voll = vollerKader(wer);
    if (voll.length === 0) return null;
    // lo ab 0, wie live vermutet: der Torwart trägt die 0.
    // Mit KB_ZEHN=1 sind nur zehn aufgestellt – der Rest hat keine
    // Position. So laesst sich pruefen, dass elf keine Pflicht ist.
    const wieViele = process.env.KB_ZEHN === "1" ? 10 : 11;
    return {
      it: voll.map((s, i) => ({
        i: String(s.i), n: s.n, ap: 24,
        ...(i < wieViele ? { lo: i } : {}),
        st: 0, pos: s.pos,
      })),
    };
  }

  // Live-Punkte am Spieltag. Mit KB_LIVE=1 antwortet **einer** der
  // Kandidaten – so lässt sich prüfen, dass die Suche ihn findet, sich den
  // Pfad merkt und die Seite danach nur noch einen Aufruf macht.
  //
  // Bewusst verschachtelt und mit Ablenkung: Der Manager heißt hier `u`,
  // nicht `i`, die Punkte `mdp`, und daneben steht ein Marktwert. Wer
  // Feldnamen rät statt zu suchen, fällt hier durch.
  if (process.env.KB_LIVE === "1" && pfad.includes(`/leagues/${LIGA}/live`)) {
    const spieler = (uid, punkte) =>
      vollerKader(String(uid)).slice(0, 11).map((s, i) => ({
        pi: String(s.i), pn: s.n, mdp: Math.max(0, punkte - i * 3), mv: s.mv,
      }));
    return {
      d: {
        ranking: {
          players: MANAGER.filter((m) => !m.adm || process.env.KB_ADMIN_SPIELT === "1")
            .map((m, i) => ({
              u: String(m.i), unm: m.n, mdp: 80 - i * 17, tv: m.tv,
              // `lp` wie in echt: eine Liste **blanker Spieler-IDs** – die
              // Aufstellung, ohne Punkte. So liefert Kickbase es
              // tatsächlich, an echten Daten abgelesen.
              lp: vollerKader(String(m.i)).slice(0, 11).map((x) => Number(x.i) || x.i),
              // Mit KB_LIVE_NUR_SUMMEN=1 fehlen die Spielerlisten mit
              // Punkten – dann bleibt nur `lp`, also die echte Lage. Die
              // Seite muss die Elf trotzdem zeigen und sagen, dass die
              // Einzelpunkte fehlen.
              ...(process.env.KB_LIVE_NUR_SUMMEN === "1"
                ? {}
                : { pl: spieler(m.i, 20 - i * 4) }),
            })),
        },
      },
    };
  }

  const squad = pfad.match(/\/managers\/(\d+)\/squad/);
  if (squad) {
    // Mit KB_ELF=1 trägt der Kader eine Aufstellung, kodiert wie bei
    // Kickbase vermutet: 1..11 Startelf, danach die Bank.
    // Mit KB_LEER=1 liefert ein Manager eine unauswertbare Antwort – der
    // Lauf muss ihn dann namentlich nennen, nicht nur zählen.
    if (process.env.KB_LEER === "1" && squad[1] === "3") return { irgendwas: true };
    const eigene = vollerKader(squad[1]);
    if (process.env.KB_ELF === "1" && eigene.length > 0) {
      // Auf 18 Spieler auffüllen – erst bei mehr als elf greift die
      // Felderkennung überhaupt. Kodiert wie vermutet: 1..11 Startelf,
      // 12..18 Bank.
      // Wie live: `lo` null-basiert für die Aufgestellten, Bank ohne Feld.
      // Mit KB_ZEHN=1 sind es zehn statt elf.
      const wieViele = process.env.KB_ZEHN === "1" ? 10 : 11;
      return {
        it: eigene.map((s, i) => ({
          pi: String(s.i), pn: s.n, pos: s.pos, mv: s.mv,
          ...(i < wieViele ? { lo: i } : {}),
        })),
      };
    }
    return { it: eigene };
  }

  if (pfad.includes("/competitions/1/table")) {
    // Mit Vereinsnamen: Der Pool soll den Namen tragen, nicht die Team-ID.
    const namen = { 7: "FC Bayern München", 2: "VfB Stuttgart", 3: "Bayer 04 Leverkusen" };
    return { it: TEAMS.map((tid) => ({ tid, tn: namen[tid] ?? null })) };
  }

  const team = pfad.match(/\/teams\/(\d+)\/teamprofile/);
  if (team) {
    // Mit KB_TEAMFEHLER=1 antwortet ein Verein nicht. Seine Spieler müssen
    // trotzdem im Pool bleiben – genau dafür wird zusammengeführt statt
    // ersetzt.
    if (process.env.KB_TEAMFEHLER === "1" && team[1] === "2") {
      const fehler = new Error("API-Fehler: 500");
      fehler.status = 500;
      throw fehler;
    }
    const kader = [...(VEREINSKADER[team[1]] ?? [])];
    // Mit KB_NEUZUGANG=1 kommt ein Spieler dazu und einer ändert seinen
    // Marktwert. So lässt sich prüfen, dass der Pool wirklich zusammenführt
    // und Neuzugänge meldet – und nicht bloß fehlerfrei durchläuft.
    if (process.env.KB_NEUZUGANG === "1" && team[1] === "7") {
      kader.push({ i: "999", n: "Neuzugang Winter", mv: 12000000, pos: 3 });
      kader[0] = { ...kader[0], mv: 70000000 };
    }
    return { it: kader };
  }

  const hist = pfad.match(/\/players\/(\d+)\/transferHistory/);
  if (hist) return { it: [] };

  // Marktwert-Historie: nur wenn KB_MW gesetzt ist, und nur unter genau
  // einem Pfad. So lässt sich beides prüfen — die Suche, die fündig wird,
  // und die, die aufgibt.
  const mw = pfad.match(/\/players\/(\d+)\/marketValue$/);
  if (mw && process.env.KB_MW === "1") {
    const heute = Date.now();
    return {
      it: Array.from({ length: 20 }, (_, i) => ({
        dt: new Date(heute - (19 - i) * 86400000).toISOString(),
        mv: 20000000 + i * 250000,
      })),
    };
  }

  // Alles andere gibt es nicht – genau wie in echt
  return null;
}

const echterFetch = globalThis.fetch;

globalThis.fetch = async function (eingabe, init) {
  const url = typeof eingabe === "string" ? eingabe : eingabe?.url ?? String(eingabe);

  if (!url.includes("api.kickbase.com")) return echterFetch(eingabe, init);

  const pfad = url.replace(/^https?:\/\/api\.kickbase\.com/, "");

  // Mit KB_ZAEHLEN=1 wird jeder Aufruf protokolliert. Damit lässt sich die
  // Frage "wie viele Kickbase-Aufrufe kostet diese Seite?" beantworten,
  // statt sie zu schätzen — und genau die kam auf, als der Nutzer in eine
  // Drosselung lief.
  if (process.env.KB_ZAEHLEN === "1") console.log(`[KB] ${pfad}`);

  // Mit KB_401=1 antwortet Kickbase auf alles mit 401 – so wie bei einem
  // abgelaufenen Token. Die Seiten müssen dann zur Anmeldung führen und
  // nicht mit einem Serverfehler sterben.
  // Mit KB_429=1 drosselt Kickbase alles – wie bei zu vielen Aufrufen.
  // Keine Seite darf daran sterben: Ein Serverfehler auf der Ligaauswahl
  // nimmt dem Nutzer die ganze App weg.
  if (process.env.KB_429 === "1" && !pfad.includes("/user/login")) {
    return antwort({ error: "too many requests" }, 429);
  }

  if (process.env.KB_401 === "1" && !pfad.includes("/user/login")) {
    return antwort({ error: "token expired" }, 401);
  }

  const daten = fuerPfad(pfad);

  if (daten === null) {
    return antwort({ error: "not found", pfad }, 404);
  }
  return antwort(daten);
};

console.log(`[Prüfstand] Kickbase-Attrappe aktiv – keine echten Aufrufe (Marktwert-Historie: ${process.env.KB_MW === "1" ? "an" : "aus"})`);
