import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GithubError, openSession, SESSION_COOKIE, type Session } from "../../src/auth/session.ts";

/** The dashboard is auth-only: no valid session cookie means sign-in. */
export async function requireSession(): Promise<Session> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  const session = raw ? openSession(raw) : null;
  if (!session) redirect("/api/auth/login");
  return session;
}

/**
 * A GitHub call from a dashboard page failed. Only a 401 means the user token
 * is gone, and a fresh sign-in mints a new one. Anything else (a 5xx, a 403
 * rate limit, no response) is a line on the page, never a bounce to login:
 * during a GitHub outage that bounce loops browser -> login -> callback -> page.
 */
export function githubFailure(e: unknown): string {
  if (e instanceof GithubError && e.status === 401) redirect("/api/auth/login");
  const why = e instanceof GithubError ? `HTTP ${e.status}` : "no response";
  return `GitHub did not answer (${why}). Try again in a minute.`;
}
