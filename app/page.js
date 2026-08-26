import { redirect } from "next/navigation";

// Der Einstieg ist die Ligaauswahl; ohne Token schickt /liga weiter zum Login.
export default function Start() {
  redirect("/liga");
}
