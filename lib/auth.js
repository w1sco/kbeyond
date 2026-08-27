import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kbFetch } from "./kickbase";

// Zugriffsschicht.
//
// Die Datenbank ist für alle Nutzer dieselbe: Events, Einstellungen und
// Korrekturen hängen an der Liga-ID, nicht am Nutzer. Ohne Prüfung könnte
// jeder Angemeldete mit einer fremden Liga-ID deren Einstellungen
// überschreiben oder gespeicherte Transfers lesen. Deshalb wird bei jedem
// Zugriff geprüft, ob der Token wirklich zu einem Mitglied dieser Liga
// gehört.

// Der Schlüssel für die persönlichen Einstellungen, aus einem bereits
// geöffneten Cookie-Speicher – für Stellen, die nicht umleiten dürfen.
export function nutzerSchluessel(store) {
  return store.get("kb_uid")?.value ?? store.get("kb_name")?.value ?? "";
}

export async function sitzung() {
  const store = await cookies();
  const token = store.get("kb_token")?.value;
  if (!token) redirect("/login");
  const uid = store.get("kb_uid")?.value ?? null;
  const name = store.get("kb_name")?.value ?? null;

  // Schlüssel für die persönlichen Einstellungen. Die Kickbase-ID ist stabil,
  // der Anzeigename nur die Rückfallebene – ändert der Nutzer ihn, bekommt er
  // einen neuen Satz Einstellungen. Ohne beides bleibt es beim gemeinsamen
  // Bestand ('').
  return { token, uid, name, nutzer: uid ?? name ?? "" };
}

// cache() hält das Ergebnis für die Dauer einer Anfrage fest – eine Seite,
// die mehrfach prüft, löst trotzdem nur einen Kickbase-Request aus.
// Wirft, wenn Kickbase nicht antwortet. Früher wurde der Fehler geschluckt
// und eine leere Liste zurückgegeben — das las istMitglied als "in keiner
// Liga" und sperrte den Nutzer mit "kein Zugriff auf diese Liga" aus, obwohl
// die Prüfung in Wahrheit gar nicht stattgefunden hatte.
export const meineLigen = cache(async (token) => {
  const daten = await kbFetch("/v4/leagues/selection", token);
  return daten.it ?? [];
});

export async function istMitglied(leagueId, token) {
  if (!leagueId) return false;
  const ligen = await meineLigen(token);
  return ligen.some((l) => String(l.i) === String(leagueId));
}

// Für Seiten: fehlende Berechtigung führt zurück zur Ligaauswahl.
//
// "Konnte nicht prüfen" ist etwas anderes als "kein Zugriff" und bekommt
// deshalb einen eigenen Text — sonst sucht man den Fehler an der falschen
// Stelle.
export async function verlangeLiga(leagueId, token) {
  let mitglied;
  try {
    mitglied = await istMitglied(leagueId, token);
  } catch {
    redirect("/liga?fehler=" + encodeURIComponent(
      "Kickbase antwortet gerade nicht — kurz warten und nochmal versuchen"));
  }
  if (!mitglied) {
    redirect("/liga?fehler=" + encodeURIComponent("Kein Zugriff auf diese Liga"));
  }
}

// Für API-Routen: gibt eine Antwort zurück, wenn etwas nicht stimmt, sonst null.
// Wird ein Ziel übergeben, endet eine Ablehnung als Weiterleitung mit
// Fehlertext statt als JSON — sonst bietet der Browser die Antwort als
// Datei zum Herunterladen an, was niemandem hilft.
export async function pruefeApi(request, leagueId, token, zurueckZu = null) {
  const ablehnen = (text, status) => {
    if (zurueckZu) {
      const ziel = new URL(zurueckZu, request.url);
      if (leagueId) ziel.searchParams.set("league", leagueId);
      ziel.searchParams.set("fehler", text);
      return Response.redirect(ziel, 303);
    }
    return Response.json({ error: text }, { status });
  };

  if (!token) return ablehnen("nicht angemeldet", 401);
  if (!leagueId) return ablehnen("league fehlt", 400);

  // Schreibende Aufrufe dürfen nicht von einer fremden Seite ausgelöst
  // werden können. Der Origin-Header ist bei POST aus dem Browser immer
  // gesetzt; fehlt er, kommt der Aufruf nicht aus einem Formular.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || new URL(origin).host !== host) {
    return ablehnen("ungültige Herkunft", 403);
  }

  try {
    if (!(await istMitglied(leagueId, token))) {
      return ablehnen("kein Zugriff auf diese Liga", 403);
    }
  } catch {
    // Kickbase erreichbar? Dann ist das kein Berechtigungsproblem.
    return ablehnen("Kickbase antwortet gerade nicht — kurz warten und nochmal versuchen", 503);
  }
  return null;
}
