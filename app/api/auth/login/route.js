import { cookies } from "next/headers";
import { kbLogin } from "@/lib/kickbase";

export async function POST(request) {
  const { email, password } = await request.json();
  try {
    const token = await kbLogin(email, password);
    const store = await cookies();
    store.set("kb_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 401 });
  }
}
