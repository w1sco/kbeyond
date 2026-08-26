import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const league = searchParams.get("league");

  if (name) {
    const store = await cookies();
    store.set("kb_name", name, {
      httpOnly: true, secure: true, sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, path: "/",
    });
  }

  return Response.redirect(new URL(`/liga?league=${league}`, request.url), 303);
}
