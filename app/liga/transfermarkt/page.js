import { redirect } from "next/navigation";
import Link from "next/link";
import { kbFetch } from "@/lib/kickbase";
import { getBesitz, getKader, getSettings, getTeamwerte, initSchema } from "@/lib/db";
import { sitzung, verlangeLiga } from "@/lib/auth";
import { normalisiereSpieler, findeSpielerListe, findeBild } from "@/lib/format";
import { holeNamen, benenne } from "@/lib/spielernamen";
import { berechneKonten, kommendeLoginBoni } from "@/lib/ledger";
import { holeAufschlaege } from "@/lib/marktbeobachtung";
import { werteAus } from "@/lib/aufschlag";
import Marktliste from "./Marktliste";
import Hinweis from "../../_ui/Hinweis";

export const dynamic = "force-dynamic";

// Tagesaktuelle Sicht auf den Transfermarkt. Anders als /liga/markt (das
// zeigt, wer keinem gehört) geht es hier um das, was gerade angeboten wird —
// deshalb ein Live-Abruf statt der Datenbank.
export default async function Transfermarkt({ searchParams }) {
  const { token, nutzer, uid: meineUid, name: meinName } = await sitzung();

  const p = await searchParams;
  if (!p.league) redirect("/liga");
  const leagueId = p.league;
  await verlangeLiga(leagueId, token);

  await initSchema();
  const ranking = await kbFetch(`/v4/leagues/${leagueId}/ranking`, token);

  let roh = null;
  let fehler = null;
  try {
    roh = await kbFetch(`/v4/leagues/${leagueId}/market`, token);
  } catch (e) {
    fehler = e.message;
  }

  // Mein Konto für den Kaufrechner
  const settings = await getSettings(leagueId, nutzer);
  const spielerListe = (ranking.us ?? []).filter((m) => m.adm !== true);
  const konten = await berechneKonten(leagueId, spielerListe, settings);
  const tw = await getTeamwerte(leagueId);
  const ich = konten.find(
    (k) => (meineUid && String(k.id) === meineUid) || (meinName && k.name === meinName)
  ) ?? null;
  const meinTeamwert = ich ? tw.map.get(String(ich.id))?.teamwert ?? 0 : 0;
  const aufLiga = werteAus(await holeAufschlaege(leagueId, settings.stichtag));

  const kader = await getKader(leagueId);
  const besitz = await getBesitz(leagueId);
  const namen = await holeNamen(leagueId);

  // Wem gehört der angebotene Spieler? Kader zuerst, dann der letzte Transfer.
  const managerName = new Map(
    (ranking.us ?? []).map((m) => [String(m.i), m.n])
  );
  const besitzerVon = new Map();
  for (const z of kader.zeilen) besitzerVon.set(String(z.player_id), managerName.get(String(z.manager_id)) ?? null);
  for (const [pid, name] of besitz.besitzer) if (!besitzerVon.has(pid)) besitzerVon.set(pid, name);

  const liste = roh ? findeSpielerListe(roh) : [];
  const angebote = liste.map((eintrag) => {
    const s = normalisiereSpieler(eintrag);
    const id = String(s.id);
    const punkte = s.punkte == null ? null : Number(s.punkte);
    const schnitt = s.schnitt == null ? null : Number(s.schnitt);
    const marktwert = s.marktwert == null ? null : Number(s.marktwert);

    return {
      id,
      name: benenne(s, namen),
      position: s.position,
      marktwert,
      trend: s.trend == null ? null : Number(s.trend),
      punkte,
      schnitt,
      // Was kostet ein Punkt? Die Kennzahl, die teuer von wertvoll trennt.
      proPunkt: marktwert != null && schnitt != null && schnitt > 0 ? marktwert / schnitt : null,
      restSek: s.ablauf == null ? null : Number(s.ablauf),
      anbieter: s.anbieter ?? besitzerVon.get(id) ?? null,
      vonKickbase: !besitzerVon.get(id) && !s.anbieter,
      bild: findeBild(eintrag),
    };
  });

  // Welche der gewünschten Angaben liefert Kickbase tatsächlich?
  const deckung = {
    gesamt: angebote.length,
    mitBild: angebote.filter((a) => a.bild).length,
    mitSchnitt: angebote.filter((a) => a.schnitt != null).length,
    mitPunkten: angebote.filter((a) => a.punkte != null).length,
    mitTrend: angebote.filter((a) => a.trend != null).length,
    mitRestzeit: angebote.filter((a) => a.restSek != null).length,
  };


  // Bis zum ersten Spiel des Spieltags kommen noch Login-Gutschriften
  // dazu — die um 0:00 Uhr, also je Mitternacht eine. Für die Planung
  // eines Kaufs ist das Geld, mit dem man rechnen darf.
  const boni = kommendeLoginBoni({
    referenz: settings.login_start ?? settings.stichtag,
    spieltagStart: settings.spieltag_start,
    aktiv: settings.login_aktiv,
  });

  return (
    <main className="kb-seite">
      <header className="kb-kopf">
        <div>
          <Link href={`/liga?league=${leagueId}`} className="kb-zurueck">← zurück zur Liga</Link>
          <h1 className="kb-titel" style={{ marginTop: 8 }}>Transfermarkt · {ranking.ti}</h1>
          <p className="kb-unter">
            Was gerade angeboten wird — live von Kickbase, nicht aus der Datenbank.
          </p>
        </div>
        <div className="kb-aktionen">
          <a href={`/liga/markt?league=${leagueId}`} className="kb-btn">Freie Spieler</a>
        </div>
      </header>

      {fehler && (
        <Hinweis art="fehler" kurz="Markt nicht abrufbar" titel="Fehler beim Abruf">
          <p>{fehler}</p>
        </Hinweis>
      )}

      {!fehler && angebote.length === 0 && (
        <p className="kb-info">Gerade steht kein Spieler auf dem Transfermarkt.</p>
      )}

      {angebote.length > 0 && (
        <>
          <Marktliste
            angebote={angebote}
            konto={ich ? ich.konto : null}
            teamwert={meinTeamwert}
            ligaAufschlag={aufLiga.relativ}
            eigenerKader={ich ? kader.proManager.get(String(ich.id)) ?? [] : []}
            boni={boni}
          />

          <Hinweis kurz="Was die Spalten bedeuten" titel="Transfermarkt">
            <p>
              <strong>€/Punkt</strong> = Marktwert ÷ Durchschnittspunkte. Die Kennzahl
              trennt teuer von wertvoll: ein 40-Mio-Spieler mit 300 Punkten pro Spiel ist
              günstiger als ein 10-Mio-Spieler mit 40.
            </p>
            <p>
              <strong>Anbieter</strong> — steht dort „Kickbase“, gehört der Spieler
              niemandem und wandert nach dem Kauf direkt in deinen Kader. Bei einem
              Mitspieler bietest du gegen dessen Preisvorstellung.
            </p>
            <p>
              Nicht jede Angabe liefert Kickbase für jeden Spieler. Was gerade da ist,
              steht unten in der Abdeckung — leere Spalten sind keine Fehler, sondern
              fehlende Daten.
            </p>
          </Hinweis>

          <p className="kb-legende">
            Abdeckung von {deckung.gesamt} Angeboten: {deckung.mitBild} mit Bild ·{" "}
            {deckung.mitSchnitt} mit Punkteschnitt · {deckung.mitPunkten} mit Punkten ·{" "}
            {deckung.mitTrend} mit Marktwert-Trend · {deckung.mitRestzeit} mit Restzeit.
            {deckung.mitSchnitt === 0 && (
              <>
                {" "}Der Punkteschnitt fehlt durchgehend — dann liefert dieser Endpoint ihn
                nicht und es bräuchte einen zweiten Abruf je Spieler.
              </>
            )}
          </p>
        </>
      )}
    </main>
  );
}
