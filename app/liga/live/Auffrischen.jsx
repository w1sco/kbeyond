"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const TAKT = 60;

// Am Spieltag ändern sich die Zahlen ständig — von Hand neu zu laden ist
// mühsam. Automatisch geht es deshalb auch, aber **nur auf Wunsch** und
// höchstens einmal je Minute: Ein Auffrischen kostet einen Kickbase-Aufruf,
// und gedrosselt zu werden hat dieses Projekt schon einmal teuer bezahlt.
export default function Auffrischen() {
  const router = useRouter();
  const [an, setAn] = useState(false);
  const [rest, setRest] = useState(TAKT);

  useEffect(() => {
    if (!an) return;
    const uhr = setInterval(() => {
      setRest((r) => {
        if (r > 1) return r - 1;
        router.refresh();
        return TAKT;
      });
    }, 1000);
    return () => clearInterval(uhr);
  }, [an, router]);

  return (
    <div className="kb-livekopf">
      <button className="kb-btn kb-btn--klein" type="button" onClick={() => router.refresh()}>
        Jetzt aktualisieren
      </button>
      <label className="kb-ankreuz">
        <input
          type="checkbox"
          checked={an}
          onChange={(e) => {
            setAn(e.target.checked);
            setRest(TAKT);
          }}
        />
        <span>
          automatisch
          {an ? ` (${rest} s)` : ` (alle ${TAKT} s)`}
        </span>
      </label>
    </div>
  );
}
