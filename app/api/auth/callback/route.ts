import { STATE_COOKIE, cookieHeader, readCookie } from "../../../../src/auth/access.ts";
import { exchangeCode, fetchViewer } from "../../../../src/auth/github.ts";
import { SESSION_COOKIE, sealSession } from "../../../../src/auth/session.ts";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookieState = readCookie(req.headers.get("cookie"), STATE_COOKIE);
  if (!state || !cookieState || state !== cookieState) {
    return new Response("state mismatch", { status: 401 });
  }
  if (!code) return new Response("missing code", { status: 401 });

  const token = await exchangeCode(code);
  const viewer = await fetchViewer(token);
  const sealed = sealSession({ login: viewer.login, userId: viewer.id, token });

  const headers = new Headers({ location: "/dashboard" });
  headers.append("set-cookie", cookieHeader(SESSION_COOKIE, sealed, 7 * 24 * 3600));
  headers.append("set-cookie", cookieHeader(STATE_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}
