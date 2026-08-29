// Live-Punkte am Spieltag.
//
// ── Nicht raten, suchen ─────────────────────────────────────────────
//
// Welcher Endpunkt die Live-Punkte liefert und unter welchem Feld, ist
// nicht belegt. Wir haben aber einen Anker, den kein Rateversuch braucht:
// **die Manager-IDs kennen wir.** Gesucht wird deshalb eine Liste in der
// Antwort, deren Einträge diese IDs tragen — und daneben eine Zahl, die
// nach Punkten aussieht. Passt beides, ist es gefunden; passt nichts,
// wird nichts zurückgegeben statt etwas Falsches.

// Kandidaten für den Endpunkt. Reihenfolge egal — es zählt, was antwortet
// und worin sich die Manager-IDs finden.
export const LIVE_PFADE = (liga, uid) => [
  `/v4/leagues/${liga}/live`,
  `/v4/leagues/${liga}/livepoints`,
  `/v4/leagues/${liga}/ranking/live`,
  `/v4/leagues/${liga}/matchday`,
  `/v4/leagues/${liga}/matchdays`,
  `/v4/leagues/${liga}/ranking?live=1`,
  `/v4/leagues/${liga}/ranking?dayNumber=0`,
  `/v4/live/${liga}`,
  ...(uid ? [`/v4/leagues/${liga}/managers/${uid}/live`] : []),
  `/v4/competitions/1/matchdays`,
  `/v4/competitions/1/matches`,
];

// Feldnamen, die nach Punkten klingen. Kein Ausschluss — nur ein Vorrang,
// falls mehrere Felder passen.
const KLINGT_NACH_PUNKTEN = /^(p|pt|pts|points|sp|mdp|lp|lpt|livepoints|tp|t)$/i;

// Punkte eines Spieltags liegen realistisch in dieser Spanne. Alles
// darüber ist ein Marktwert, kein Punktestand.
const MAX_PUNKTE = 2000;

function istObjekt(x) {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

// Alle Listen finden, deren Einträge bekannte IDs tragen — samt dem Feld,
// das die Punkte hält.
export function findePunkte(daten, ids) {
  const bekannt = new Set([...(ids ?? [])].map(String));
  if (bekannt.size === 0) return [];

  const funde = [];

  const pruefeListe = (liste, pfad) => {
    const objekte = liste.filter(istObjekt);
    if (objekte.length < 2) return;

    const felder = new Set();
    for (const o of objekte) for (const k of Object.keys(o)) felder.add(k);

    for (const idFeld of felder) {
      const passend = objekte.filter((o) => bekannt.has(String(o[idFeld])));
      // Zwei Treffer können Zufall sein, drei kaum noch.
      if (passend.length < 2) continue;

      for (const punkteFeld of felder) {
        if (punkteFeld === idFeld) continue;
        const werte = passend.map((o) => Number(o[punkteFeld]));
        if (!werte.every((n) => Number.isFinite(n) && n >= 0 && n <= MAX_PUNKTE)) continue;

        funde.push({
          pfad: pfad || "(Wurzel)",
          idFeld,
          punkteFeld,
          abdeckung: passend.length,
          verschieden: new Set(werte).size,
          treffer: new Map(passend.map((o) => [String(o[idFeld]), Number(o[punkteFeld])])),
          // Die Objekte selbst: In ihnen stecken die Spielerlisten.
          eintraege: new Map(passend.map((o) => [String(o[idFeld]), o])),
        });
      }
    }
  };

  const geh = (knoten, pfad, tiefe) => {
    if (tiefe > 5 || knoten == null || typeof knoten !== "object") return;
    if (Array.isArray(knoten)) {
      pruefeListe(knoten, pfad);
      // **Alle** Einträge weiterverfolgen, nicht nur die ersten. Die
      // Spielerlisten hängen je Manager einzeln im Baum – wer hier abkürzt,
      // sieht nur die Elf der ersten paar Manager.
      for (const x of knoten) geh(x, `${pfad}[]`, tiefe + 1);
      return;
    }
    for (const [k, v] of Object.entries(knoten)) {
      geh(v, pfad ? `${pfad}.${k}` : k, tiefe + 1);
    }
  };

  geh(daten, "", 0);

  // Bester Fund zuerst: sprechender Feldname, viele Manager, und Werte,
  // die sich unterscheiden — ein Feld, in dem überall dasselbe steht,
  // sagt nichts.
  return funde.sort((a, b) => punkte(b) - punkte(a));
}

function punkte(f) {
  return (
    (KLINGT_NACH_PUNKTEN.test(f.punkteFeld) ? 100 : 0) +
    (f.verschieden > 1 ? 40 : 0) +
    f.abdeckung
  );
}

// Der beste Fund, oder nichts.
export function besterFund(daten, ids) {
  const alle = findePunkte(daten, ids);
  // Ein Feld, in dem bei allen dasselbe steht, ist kein Punktestand.
  const brauchbar = alle.filter((f) => f.verschieden > 1);
  return brauchbar[0] ?? null;
}

// Alle Treffer eines Feldpaars zusammenfassen.
//
// Die Spielerlisten hängen je Manager einzeln im Baum: `players[0].pl`,
// `players[1].pl`, … Jede für sich ist ein eigener Fund. Wer nur den
// besten nimmt, bekommt die Elf **eines** Managers und hält den Rest für
// nicht vorhanden — genau das ist beim ersten Anlauf passiert.
export function sammleTreffer(daten, ids) {
  const alle = findePunkte(daten, ids).filter((f) => f.verschieden > 1);
  const bester = alle[0];
  if (!bester) return null;

  const zusammen = new Map();
  const eintraege = new Map();
  for (const f of alle) {
    // Nur Funde desselben Feldpaars – sonst mischt sich ein anderes Feld
    // (etwa der Marktwert) unter die Punkte.
    if (f.idFeld !== bester.idFeld || f.punkteFeld !== bester.punkteFeld) continue;
    for (const [id, wert] of f.treffer) zusammen.set(id, wert);
    for (const [id, o] of f.eintraege) eintraege.set(id, o);
  }
  return {
    idFeld: bester.idFeld,
    punkteFeld: bester.punkteFeld,
    treffer: zusammen,
    eintraege,
  };
}

// ── Die Spieler eines Managers ──────────────────────────────────────
//
// Bisher wurden sie über die Spieler-IDs aus dem **gespeicherten Kader**
// gesucht. Das trägt nur, solange beide Seiten dieselben IDs führen — ist
// der Kader einen Transfer alt oder schneidet Kickbase die IDs anders,
// bleibt die Spalte leer, obwohl die Daten in der Antwort stehen.
//
// Verlässlicher ist der Eintrag des Managers selbst: Was darin als Liste
// von Einträgen mit ID und Punktzahl steht, sind seine Spieler. Dafür
// braucht es unseren Kader gar nicht.

const ID_FELDER = ["pi", "i", "id"];

// Wie heißt das ID-Feld dieser Liste?
//
// Erst wurden nur `pi`, `i` und `id` akzeptiert. Heißt es bei Kickbase
// anders (`pid`, `playerId`, …), fiel die ganze Liste durch und die
// Einzelpunkte blieben leer, obwohl sie dastanden.
//
// Eine ID erkennt man aber an ihrer **Eigenschaft**, nicht an ihrem Namen:
// Sie ist je Eintrag verschieden. Bekannte Namen gewinnen, alles andere
// kommt danach.
function idFelder(objekte) {
  const felder = new Set();
  for (const o of objekte) for (const k of Object.keys(o)) felder.add(k);

  const passend = [];
  for (const f of felder) {
    const werte = objekte.map((o) => o[f]);
    if (!werte.every((v) => typeof v === "string" || typeof v === "number")) continue;
    // Eindeutig je Eintrag – sonst ist es keine ID.
    if (new Set(werte.map(String)).size !== objekte.length) continue;
    passend.push(f);
  }

  passend.sort((a, b) => ID_FELDER.indexOf(b) - ID_FELDER.indexOf(a));
  return passend;
}

// Findet im Eintrag eines Managers die Liste seiner Spieler samt Punktfeld.
//
// `punkteFeld` ist das Feld, unter dem die **Managersumme** stand. Trägt
// eine Liste dasselbe Feld, ist das der stärkste Hinweis, den es hier gibt:
// Kickbase benennt beide Ebenen erfahrungsgemäß gleich.
export function spielerImEintrag(eintrag, punkteFeld) {
  if (!istObjekt(eintrag)) return null;

  const kandidaten = [];

  const geh = (knoten, tiefe) => {
    if (tiefe > 6 || knoten == null || typeof knoten !== "object") return;

    if (Array.isArray(knoten)) {
      const objekte = knoten.filter(istObjekt);
      if (objekte.length >= 2) {
        const felder = new Set();
        for (const o of objekte) for (const k of Object.keys(o)) felder.add(k);

        for (const idFeld of idFelder(objekte)) {
          for (const feld of felder) {
            if (feld === idFeld) continue;

            // **Das Punktefeld bleibt am Namen verankert.** Sonst würde
            // hier irgendeine Zahl zur Punktzahl — und eine falsche Zahl
            // ist schlimmer als gar keine, weil danach jemand entscheidet.
            const gleich = feld === punkteFeld;
            if (!gleich && !KLINGT_NACH_PUNKTEN.test(feld)) continue;

            const werte = objekte.map((o) => Number(o[feld]));
            if (!werte.every((n) => Number.isFinite(n) && n >= 0 && n <= MAX_PUNKTE)) continue;

            kandidaten.push({
              feld,
              idFeld,
              gleich,
              verschieden: new Set(werte).size,
              spieler: objekte,
            });
          }
        }
      }
      for (const x of knoten) geh(x, tiefe + 1);
      return;
    }

    for (const v of Object.values(knoten)) geh(v, tiefe + 1);
  };

  geh(eintrag, 0);

  // Ein Feld, in dem überall dasselbe steht, ist nur brauchbar, wenn es
  // **genauso heißt** wie die Managersumme. Vor dem Anpfiff stehen alle
  // Spieler auf 0 — das ist dann echt und keine zufällige Nullspalte.
  const brauchbar = kandidaten.filter((k) => k.verschieden > 1 || k.gleich);
  if (brauchbar.length === 0) return null;

  const rang = (k) =>
    (k.gleich ? 200 : 0) +
    (KLINGT_NACH_PUNKTEN.test(k.feld) ? 100 : 0) +
    (k.verschieden > 1 ? 40 : 0) +
    k.spieler.length;

  brauchbar.sort((a, b) => rang(b) - rang(a));

  const gewinner = brauchbar[0];
  return {
    punkteFeld: gewinner.feld,
    idFeld: gewinner.idFeld,
    spieler: gewinner.spieler.map((o) => ({
      id: String(o[gewinner.idFeld]),
      punkte: Number(o[gewinner.feld]),
      roh: o,
    })),
  };
}

// ── Die Aufstellung als blanke ID-Liste ─────────────────────────────
//
// An echten Daten gefunden: Der Managereintrag trägt unter `lp` ein Array
// aus **blanken Zahlen** — die Spieler seiner Aufstellung. Punkte stehen
// dort nicht, aber die IDs sind Gold wert: Mit ihnen lässt sich dieselbe
// Antwort ein zweites Mal durchsuchen, ohne einen Aufruf zu kosten, und
// sie sind die **aktuelle** Elf, nicht unser gespeicherter Stand.
//
// Erkannt wird die Liste an ihrer Form, nicht am Namen `lp`: ein Array aus
// mindestens zwei einfachen Werten, die sich nicht wiederholen und die wie
// IDs aussehen (Zahlen, keine Nachkommastellen).
export function idListeImEintrag(eintrag) {
  if (!istObjekt(eintrag)) return [];

  const gefunden = [];

  const geh = (knoten, tiefe) => {
    if (tiefe > 4 || knoten == null || typeof knoten !== "object") return;

    if (Array.isArray(knoten)) {
      const einfach = knoten.filter(
        (x) => typeof x === "number" || typeof x === "string"
      );
      if (einfach.length >= 2 && einfach.length === knoten.length) {
        const werte = einfach.map(String);
        const sieht_aus_wie_ids = werte.every((w) => /^\d{2,10}$/.test(w));
        if (sieht_aus_wie_ids && new Set(werte).size === werte.length) {
          gefunden.push(werte);
        }
      }
      for (const x of knoten) geh(x, tiefe + 1);
      return;
    }

    for (const v of Object.values(knoten)) geh(v, tiefe + 1);
  };

  geh(eintrag, 0);

  // Die längste Liste ist die Aufstellung — kürzere sind eher Nebensachen
  // (etwa zwei Vereins-IDs eines Spiels).
  gefunden.sort((a, b) => b.length - a.length);
  return gefunden[0] ?? [];
}

// Alle Spielerobjekte einer Antwort einsammeln, egal wie tief sie liegen.
export function spielerObjekte(daten, tiefe = 0) {
  if (tiefe > 5 || daten == null || typeof daten !== "object") return [];
  if (Array.isArray(daten)) {
    const eigene = daten.filter(
      (x) => x != null && typeof x === "object" && !Array.isArray(x)
    );
    return [...eigene, ...daten.flatMap((x) => spielerObjekte(x, tiefe + 1))];
  }
  return Object.values(daten).flatMap((v) => spielerObjekte(v, tiefe + 1));
}

export function idAus(o) {
  for (const f of ["pi", "i", "id"]) {
    const w = o?.[f];
    if (typeof w === "string" || typeof w === "number") return String(w);
  }
  return null;
}

// Sucht in einer Antwort das Feld, dessen Summe über die Elf genau `soll`
// ergibt. Gibt alle geprüften Felder mit ihrer Summe zurück — auch wenn
// keins passt, sagt das etwas.
export function feldMitSumme(daten, elfIds, soll) {
  const gesucht = new Set(elfIds.map(String));
  const objekte = spielerObjekte(daten).filter((o) => gesucht.has(idAus(o)));
  if (objekte.length === 0) return { treffer: null, geprueft: [], gefunden: 0 };

  const felder = new Set();
  for (const o of objekte) for (const k of Object.keys(o)) felder.add(k);

  const geprueft = [];
  let treffer = null;

  for (const feld of felder) {
    const werte = objekte.map((o) => Number(o[feld]));
    if (!werte.every((n) => Number.isFinite(n))) continue;
    const summe = werte.reduce((a, b) => a + b, 0);
    geprueft.push({ feld, summe });
    if (summe === soll && soll > 0) treffer = { feld, summe };
  }

  geprueft.sort((a, b) => Math.abs(a.summe - soll) - Math.abs(b.summe - soll));
  return { treffer, geprueft: geprueft.slice(0, 8), gefunden: objekte.length };
}

