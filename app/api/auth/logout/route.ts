import { cookieHeader } from "../../../../src/auth/access.ts";
import { SESSION_COOKIE } from "../../../../src/auth/session.ts";

export async function POST(): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": cookieHeader(SESSION_COOKIE, "", 0),
    },
  });
}
