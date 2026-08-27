import ManagerSeite from "../../../manager/[id]/page";
import Schublade from "../../../../_ui/Schublade";

export const dynamic = "force-dynamic";

// Dieselbe Seite, nur in der Schublade. Der Inhalt wird nicht kopiert —
// die Managerseite bekommt lediglich mitgeteilt, dass sie ohne eigene
// Kopfzeile und ohne "zurück zur Liga" auskommt.
export default async function ManagerSchublade({ params, searchParams }) {
  const { id } = await params;
  const p = await searchParams;

  return (
    <Schublade titel="Manager">
      <ManagerSeite
        params={Promise.resolve({ id })}
        searchParams={Promise.resolve(p)}
        imPanel
      />
    </Schublade>
  );
}
