import { getRepo, type RepoRow } from "../db/index.ts";
import { SESSION_COOKIE, getUserInstallationIds, openSession, type Session } from "./session.ts";

export const STATE_COOKIE = "aidep_oauth_state";

/** Serialize a Set-Cookie value with the attributes every aidep cookie uses. */
export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  const secure = (process.env.APP_URL ?? "").startsWith("https") ? "; Secure" : "";
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

// ponytail: per-process 60s cache of the user's installation ids. Saves a
// GitHub round trip on bursts of dashboard requests; the tradeoff is a
// revoked installation stays visible for up to a minute, and each server
// instance caches independently. Swap for a shared cache if either bites.
const installCache = new Map<number, { ids: number[]; at: number }>();

export async function requireRepoAccess(
  session: Session,
  repoId: number,
): Promise<{ repo: RepoRow | null; allowed: boolean }> {
  const repo = await getRepo(repoId);
  if (!repo) return { repo: null, allowed: false };
  const cached = installCache.get(session.userId);
  let ids: number[];
  if (cached && Date.now() - cached.at < 60_000) {
    ids = cached.ids;
  } else {
    ids = await getUserInstallationIds(session.token);
    installCache.set(session.userId, { ids, at: Date.now() });
  }
  // postgres returns bigint columns as strings; the GitHub ids are numbers
  return { repo, allowed: ids.includes(Number(repo.installation_id)) };
}
