import { cookies } from "next/headers";
import { kbLogin, tokenAblauf } from "@/lib/kickbase";

export const dynamic = "force-dynamic";

// Wie lange das Cookie hält, wenn das Token seinen Ablauf nicht verrät.
// Lieber großzügig: Läuft das Token vorher ab, führt der nächste Aufruf
// sauber zur Anmeldung zurück — das ist verkraftbar. Ein zu kurzes Cookie
// dagegen wirft den Nutzer raus, obwohl sein Token noch gilt.
const OHNE_ABLAUF_TAGE = 90;

export async function POST(request) {
  const { email, password, bleiben = true } = await request.json();
  try {
    const { token, userId, userName } = await kbLogin(email, password, {
      angemeldetBleiben: !!bleiben,
    });

    // Das Cookie soll nicht länger leben als das Token, das es trägt —
    // sonst sieht der Nutzer eine angemeldete Oberfläche, hinter der jeder
    // Kickbase-Aufruf mit 401 scheitert.
    const ablauf = tokenAblauf(token);
    const maxAge = !bleiben
      ? undefined // Sitzungscookie: weg, sobald der Browser zugeht
      : ablauf
        ? Math.floor((ablauf - Date.now()) / 1000)
        : OHNE_ABLAUF_TAGE * 24 * 3600;

    const store = await cookies();
    const opt = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
    if (maxAge !== undefined) opt.maxAge = maxAge;

    store.set("kb_token", token, opt);
    if (userId) store.set("kb_uid", userId, opt);
    if (userName) store.set("kb_name", userName, opt);

    // Der Ablauf wird mitgeschrieben, damit die Ligaseite sagen kann, bis
    // wann die Anmeldung gilt. Kein Geheimnis, aber es gehört zur Sitzung
    // und wird mit ihr zusammen ungültig.
    if (ablauf) store.set("kb_exp", ablauf.toISOString(), opt);
    else store.delete("kb_exp");

    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 401 });
  }
}
