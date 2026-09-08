import { STATE_COOKIE, cookieHeader, readCookie } from "../../../../src/auth/access.ts";
import { exchangeCode, fetchViewer } from "../../../../src/auth/github.ts";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sealSession } from "../../../../src/auth/session.ts";

/** GitHub said no: back to the landing page with the state cookie gone. */
function denied(): Response {
  return new Response(null, {
    status: 302,
    headers: { location: "/?auth=denied", "set-cookie": cookieHeader(STATE_COOKIE, "", 0) },
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookieState = readCookie(req.headers.get("cookie"), STATE_COOKIE);
  if (!state || !cookieState || state !== cookieState) {
    return new Response("state mismatch", { status: 401 });
  }
  // no code is what ?error=access_denied looks like: the user clicked Cancel at GitHub
  if (!code) return denied();

  let token: string;
  let viewer: { login: string; id: number };
  try {
    token = await exchangeCode(code);
    viewer = await fetchViewer(token);
  } catch {
    // a stale or reused code: back button, double callback
    return denied();
  }
  const sealed = sealSession({ login: viewer.login, userId: viewer.id, token });

  const headers = new Headers({ location: "/dashboard" });
  headers.append("set-cookie", cookieHeader(SESSION_COOKIE, sealed, SESSION_MAX_AGE_SECONDS));
  headers.append("set-cookie", cookieHeader(STATE_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}
