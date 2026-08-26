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

export async function sitzung() {
  const store = await cookies();
  const token = store.get("kb_token")?.value;
  if (!token) redirect("/login");
  return {
    token,
    uid: store.get("kb_uid")?.value ?? null,
    name: store.get("kb_name")?.value ?? null,
  };
}

// cache() hält das Ergebnis für die Dauer einer Anfrage fest – eine Seite,
// die mehrfach prüft, löst trotzdem nur einen Kickbase-Request aus.
export const meineLigen = cache(async (token) => {
  try {
    const daten = await kbFetch("/v4/leagues/selection", token);
    return daten.it ?? [];
  } catch {
    return [];
  }
});

export async function istMitglied(leagueId, token) {
  if (!leagueId) return false;
  const ligen = await meineLigen(token);
  return ligen.some((l) => String(l.i) === String(leagueId));
}

// Für Seiten: fehlende Berechtigung führt zurück zur Ligaauswahl.
export async function verlangeLiga(leagueId, token) {
  if (!(await istMitglied(leagueId, token))) {
    redirect("/liga?fehler=" + encodeURIComponent("Kein Zugriff auf diese Liga"));
  }
}

// Für API-Routen: gibt eine Antwort zurück, wenn etwas nicht stimmt, sonst null.
export async function pruefeApi(request, leagueId, token) {
  if (!token) return Response.json({ error: "nicht angemeldet" }, { status: 401 });
  if (!leagueId) return Response.json({ error: "league fehlt" }, { status: 400 });

  // Schreibende Aufrufe dürfen nicht von einer fremden Seite ausgelöst
  // werden können. Der Origin-Header ist bei POST aus dem Browser immer
  // gesetzt; fehlt er, kommt der Aufruf nicht aus einem Formular.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || new URL(origin).host !== host) {
    return Response.json({ error: "ungültige Herkunft" }, { status: 403 });
  }

  if (!(await istMitglied(leagueId, token))) {
    return Response.json({ error: "kein Zugriff auf diese Liga" }, { status: 403 });
  }
  return null;
}
