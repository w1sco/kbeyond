"use client";
import { useState, useSyncExternalStore } from "react";
import { ZYKLUS_TAGE, ZYKLUS_BEREICH } from "@/lib/rhythmus";

// ── Der gemerkte Markt-Rhythmus, als externer Speicher ─────────────
//
// Der localStorage ist ein Speicher außerhalb von React, und genau so wird
// er gelesen: über useSyncExternalStore. Das löst zwei Dinge auf einmal —
// auf dem Server gilt die Vorgabe (kein Hydrierungskonflikt, der hier
// schon einmal die Aufstellungsauswahl gekostet hat), und es braucht kein
// setState in einem Effekt, das der Linter zu Recht anmahnt.
//
// Gemerkt wird je Liga (`kb_zyklus_{liga}`). Markt- und Matchup-Seite lesen
// denselben Wert: Wer den Regler auf der Marktseite schiebt, bekommt auf
// der Matchup-Seite dieselbe Antwort auf „kommt er vor dem Anpfiff?“.
const hoerer = new Set();
function abonniere(cb) {
  hoerer.add(cb);
  window.addEventListener("storage", cb);
  return () => { hoerer.delete(cb); window.removeEventListener("storage", cb); };
}
function ladeZyklus(schluessel) {
  try {
    const n = Number(localStorage.getItem(schluessel));
    return n >= ZYKLUS_BEREICH[0] && n <= ZYKLUS_BEREICH[1] ? n : ZYKLUS_TAGE;
  } catch {
    return ZYKLUS_TAGE; // kein Speicher (privater Modus o. ä.) – dann die Vorgabe
  }
}
function merkeZyklus(schluessel, n) {
  try { localStorage.setItem(schluessel, String(n)); } catch { /* dann nur bis zum Neuladen */ }
  for (const cb of hoerer) cb();
}

// [zyklus, setzen]
export function useZyklus(leagueId) {
  const schluessel = `kb_zyklus_${leagueId}`;
  const gemerkt = useSyncExternalStore(
    abonniere, () => ladeZyklus(schluessel), () => ZYKLUS_TAGE);
  // Fällt der Speicher aus, hält der Zustand den Wert bis zum Neuladen.
  const [ungespeichert, setUngespeichert] = useState(null);
  function setzen(n) {
    setUngespeichert(n);
    merkeZyklus(schluessel, n);
  }
  return [ungespeichert ?? gemerkt, setzen];
}
