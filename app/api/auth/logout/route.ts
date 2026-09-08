import { cookieHeader, getSessionFromCookies } from "../../../../src/auth/access.ts";
import { revokeToken } from "../../../../src/auth/github.ts";
import { SESSION_COOKIE } from "../../../../src/auth/session.ts";

export async function POST(req: Request): Promise<Response> {
  const session = getSessionFromCookies(req.headers.get("cookie"));
  // best effort: sign-out must not depend on GitHub answering
  if (session) await revokeToken(session.token).catch(() => {});
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": cookieHeader(SESSION_COOKIE, "", 0),
    },
  });
}
