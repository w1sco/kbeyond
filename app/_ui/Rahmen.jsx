import Link from "next/link";
import Logo from "./Logo";

// Kopf- und Fußzeile für **alle** Seiten. Sie stehen im Wurzel-Layout,
// damit auch die Diagnoseseiten sie bekommen — ohne dass jede Seite
// daran denken muss.

export function Kopfleiste() {
  return (
    <header className="kb-topbar">
      <Link href="/liga" className="kb-topbar-marke" aria-label="KBeyond – zur Ligaauswahl">
        <Logo />
      </Link>
    </header>
  );
}

export function Fussleiste() {
  return (
    <footer className="kb-fuss">
      <span>created by wisco</span>
      <span className="kb-fuss-punkt" aria-hidden="true">·</span>
      <span>Kickbase-Liga-Analyse</span>
    </footer>
  );
}
