import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Dashboard session: the GitHub user plus their user-to-server OAuth token,
 * sealed into an AES-256-GCM cookie. The token never touches the database;
 * authorization is answered per request by GitHub, per repo
 * (GET /user/installations/{id}/repositories).
 */
export interface Session {
  login: string;
  userId: number;
  token: string;
  /** issued at, ms since epoch: the seal carries its own expiry, not only the cookie's Max-Age */
  iat: number;
}

export const SESSION_COOKIE = "aidep_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600;

function key(secret = process.env.SESSION_SECRET): Buffer {
  if (!secret) throw new Error("SESSION_SECRET must be set");
  return createHash("sha256").update(secret).digest();
}

export function sealSession(s: Omit<Session, "iat">, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const payload = JSON.stringify({ ...s, iat: Date.now() });
  const ct = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

export function openSession(value: string, secret?: string): Session | null {
  try {
    const raw = Buffer.from(value, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(secret), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    const s = JSON.parse(json) as Session;
    if (
      typeof s.login !== "string" ||
      typeof s.userId !== "number" ||
      typeof s.token !== "string" ||
      typeof s.iat !== "number"
    ) {
      return null;
    }
    if (Date.now() - s.iat > SESSION_MAX_AGE_SECONDS * 1000) return null;
    return s;
  } catch {
    return null;
  }
}

/** A non-2xx from api.github.com. 401 is an expired user token; anything else is GitHub's problem, not the user's. */
export class GithubError extends Error {
  constructor(
    public readonly status: number,
    path: string,
  ) {
    super(`${path}: HTTP ${status}`);
  }
}

/** Every page of a GitHub list endpoint whose body wraps the items under `key`. */
async function listAll<T>(
  token: string,
  path: string,
  key: string,
  fetchImpl: typeof fetch,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetchImpl(`https://api.github.com/${path}?per_page=100&page=${page}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!res.ok) throw new GithubError(res.status, path);
    const data = (await res.json()) as Record<string, T[]>;
    items.push(...data[key]);
    if (data[key].length < 100) break;
  }
  return items;
}

/** Installations the signed-in user can see at least one repo of, straight from GitHub. */
export async function getUserInstallationIds(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number[]> {
  const rows = await listAll<{ id: number }>(token, "user/installations", "installations", fetchImpl);
  return rows.map((i) => i.id);
}

/**
 * Repos inside one installation that the user's own account can read. This
 * is the whole authorization model: GitHub answers who sees what, per repo,
 * so an outside collaborator on one repo of an org-wide install sees that
 * repo only. A user who cannot see the installation at all gets a 404 from
 * GitHub, which is the same answer as an empty list.
 */
export async function getUserInstallationRepoIds(
  token: string,
  installationId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number[]> {
  try {
    const rows = await listAll<{ id: number }>(
      token,
      `user/installations/${installationId}/repositories`,
      "repositories",
      fetchImpl,
    );
    return rows.map((r) => r.id);
  } catch (e) {
    if (e instanceof GithubError && e.status === 404) return [];
    throw e;
  }
}

export interface UserAccess {
  installationIds: number[];
  repoIds: number[];
}

/** Everything the signed-in user can see: their installations, and the repos inside each that their account can read. */
export async function getUserAccess(token: string, fetchImpl: typeof fetch = fetch): Promise<UserAccess> {
  const installationIds = await getUserInstallationIds(token, fetchImpl);
  const perInstallation = await Promise.all(
    installationIds.map((id) => getUserInstallationRepoIds(token, id, fetchImpl)),
  );
  return { installationIds, repoIds: perInstallation.flat() };
}
