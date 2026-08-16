import { randomBytes } from "node:crypto";
import { STATE_COOKIE, cookieHeader } from "../../../../src/auth/access.ts";
import { buildAuthorizeUrl } from "../../../../src/auth/github.ts";

export async function GET(): Promise<Response> {
  const state = randomBytes(16).toString("hex");
  return new Response(null, {
    status: 302,
    headers: {
      location: buildAuthorizeUrl(state),
      "set-cookie": cookieHeader(STATE_COOKIE, state, 600),
    },
  });
}
