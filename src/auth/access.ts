import { timingSafeEqual } from "node:crypto";
import { getRepo, type RepoRow } from "../db/index.ts";
import { SESSION_COOKIE, getUserInstallationIds, openSession, type Session } from "./session.ts";

export const STATE_COOKIE = "aidep_oauth_state";

/** Constant-time bearer-token check that never throws on a length mismatch. */
export function bearerMatches(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Serialize a Set-Cookie value with the attributes every aidep cookie uses. */
export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  // Secure on https, and unconditionally in production so a misconfigured
  // APP_URL can never drop it from a live session cookie.
  const secure =
    (process.env.APP_URL ?? "").startsWith("https") || process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";
  return `${name}=${value}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

/** Read one cookie out of a raw Cookie header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(/; */)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return undefined;
}

/** The subset of next/headers cookies() we need. */
interface CookieStoreish {
  get(name: string): { value: string } | undefined;
}

/**
 * Open the session cookie from either a cookies() store (server components,
 * route handlers via next/headers) or a raw Cookie header string (plain
 * Request handlers, tests). Returns null when absent or tampered.
 */
export function getSessionFromCookies(
  cookieStore: CookieStoreish | string | null | undefined,
): Session | null {
  if (!cookieStore) return null;
  const value =
    typeof cookieStore === "string"
      ? readCookie(cookieStore, SESSION_COOKIE)
      : cookieStore.get(SESSION_COOKIE)?.value;
  return value ? openSession(value) : null;
}

export async function requireRepoAccess(
  session: Session,
  repoId: number,
): Promise<{ repo: RepoRow | null; allowed: boolean }> {
  // repoId comes from Number() on a path segment; reject NaN/floats/negatives
  // before they reach a bigint query.
  if (!Number.isInteger(repoId) || repoId <= 0) return { repo: null, allowed: false };
  const repo = await getRepo(repoId);
  if (!repo) return { repo: null, allowed: false };
  // Authorization is answered fresh by GitHub on every request: no cache, so a
  // revoked installation is denied on the next call, not up to a minute later.
  const ids = await getUserInstallationIds(session.token);
  // postgres returns bigint columns as strings; the GitHub ids are numbers
  return { repo, allowed: ids.includes(Number(repo.installation_id)) };
}
