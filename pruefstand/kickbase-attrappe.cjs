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
  { i: 9, n: "Der Admin", sp: 0, tv: 0,         spl: 4, adm: true },
];

const MARKT = [
  { i: "101", fn: "Harry",  ln: "Kane",    mv: 68800000, prc: 68800000, exs: 42000, pos: 4, ap: 216, tp: 648, mvt: 1 },
  { i: "102", fn: "Angelo", ln: "Stiller", mv: 36600000, prc: 36600000, exs: 38000, pos: 3, ap: 119, tp: 357, mvt: 0 },
  { i: "103", fn: "Patrik", ln: "Schick",  mv: 29400000, prc: 29400000, exs: 12000, pos: 4, ap: 103, tp: 309, mvt: 2 },
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

function fuerPfad(pfad) {
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

  const squad = pfad.match(/\/managers\/(\d+)\/squad/);
  if (squad) return { it: KADER[squad[1]] ?? [] };

  if (pfad.includes("/competitions/1/table")) return { it: TEAMS.map((tid) => ({ tid })) };

  const team = pfad.match(/\/teams\/(\d+)\/teamprofile/);
  if (team) return { it: VEREINSKADER[team[1]] ?? [] };

  const hist = pfad.match(/\/players\/(\d+)\/transferHistory/);
  if (hist) return { it: [] };

  // Alles andere gibt es nicht – genau wie in echt
  return null;
}

const echterFetch = globalThis.fetch;

globalThis.fetch = async function (eingabe, init) {
  const url = typeof eingabe === "string" ? eingabe : eingabe?.url ?? String(eingabe);

  if (!url.includes("api.kickbase.com")) return echterFetch(eingabe, init);

  const pfad = url.replace(/^https?:\/\/api\.kickbase\.com/, "");
  const daten = fuerPfad(pfad);

  if (daten === null) {
    return antwort({ error: "not found", pfad }, 404);
  }
  return antwort(daten);
};

console.log("[Prüfstand] Kickbase-Attrappe aktiv – keine echten Aufrufe");
