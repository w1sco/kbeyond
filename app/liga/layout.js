// Layout für alles unter /liga.
//
// Der zweite Bereich `panel` ist ein paralleler Slot: Ein Klick auf einen
// Managernamen öffnet dessen Seite als Schublade über der Tabelle, statt
// die Seite zu wechseln. Ein direkter Aufruf derselben Adresse (Neuladen,
// geteilter Link) zeigt weiterhin die vollständige Seite.
export default function LigaLayout({ children, panel }) {
  return (
    <>
      {children}
      {panel}
    </>
  );
}
