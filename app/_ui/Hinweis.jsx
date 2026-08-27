"use client";
import { useRef } from "react";

// Hinweis als anklickbares Popup.
//
// Vorher standen Erklärungen als große Kästen dauerhaft auf der Seite und
// haben die Zahlen verdrängt, um die es eigentlich geht. Jetzt steht in der
// Zeile nur ein Anreißer; der ganze Text kommt auf Klick.
//
// <dialog> statt eigenem Overlay: schließt von selbst mit Escape, fängt den
// Tastaturfokus ein und braucht keine Bibliothek.
export default function Hinweis({ art = "info", titel, kurz, children }) {
  const dialog = useRef(null);

  const zeichen = art === "warn" || art === "fehler" ? "!" : "i";

  // Klick neben das Fenster schließt. Nicht über das Klickziel geprüft: der
  // Inhalt füllt das <dialog> vollständig aus, es bleibt also keine Fläche
  // übrig, auf der das Element selbst getroffen würde. Die Koordinaten sind
  // eindeutig.
  function hintergrundKlick(e) {
    const rahmen = dialog.current?.getBoundingClientRect();
    if (!rahmen) return;
    const drin =
      e.clientX >= rahmen.left && e.clientX <= rahmen.right &&
      e.clientY >= rahmen.top && e.clientY <= rahmen.bottom;
    if (!drin) dialog.current.close();
  }

  return (
    <>
      <button
        type="button"
        className={`kb-hinweisknopf kb-hinweisknopf--${art}`}
        onClick={() => dialog.current?.showModal()}
      >
        <span className="kb-hinweiszeichen" aria-hidden="true">{zeichen}</span>
        <span className="kb-hinweiskurz">{kurz}</span>
        <span className="kb-hinweismehr">mehr</span>
      </button>

      <dialog ref={dialog} className="kb-dialog" onClick={hintergrundKlick}>
        <div className="kb-dialog-inhalt">
          <button
            type="button"
            className="kb-dialog-zu"
            onClick={() => dialog.current.close()}
            aria-label="Schließen"
          >
            ×
          </button>
          <h3 className="kb-dialog-titel">{titel ?? kurz}</h3>
          <div className="kb-dialog-text">{children}</div>
          <button type="button" className="kb-btn kb-btn--stark" onClick={() => dialog.current.close()}>
            Verstanden
          </button>
        </div>
      </dialog>
    </>
  );
}
