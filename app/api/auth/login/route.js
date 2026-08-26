import { cookies } from "next/headers";
import { kbLogin } from "@/lib/kickbase";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { email, password } = await request.json();
  try {
    const { token, userId, userName } = await kbLogin(email, password);
    const store = await cookies();
    const opt = { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/" };

    store.set("kb_token", token, opt);
    if (userId) store.set("kb_uid", userId, opt);
    if (userName) store.set("kb_name", userName, opt);

    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 401 });
  }
}
