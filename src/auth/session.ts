import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Dashboard session: the GitHub user plus their user-to-server OAuth token,
 * sealed into an AES-256-GCM cookie. The token never touches the database;
 * authorization is answered per request by GitHub (GET /user/installations).
 */
export interface Session {
  login: string;
  userId: number;
  token: string;
}

export const SESSION_COOKIE = "aidep_session";

function key(secret = process.env.SESSION_SECRET): Buffer {
  if (!secret) throw new Error("SESSION_SECRET must be set");
  return createHash("sha256").update(secret).digest();
}

export function sealSession(s: Session, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(s), "utf8"), cipher.final()]);
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
    if (typeof s.login !== "string" || typeof s.userId !== "number" || typeof s.token !== "string") {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

/**
 * Installations the signed-in user can access, straight from GitHub. This is
 * the whole authorization model: GitHub answers who sees what.
 */
export async function getUserInstallationIds(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetchImpl(`https://api.github.com/user/installations?per_page=100&page=${page}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!res.ok) throw new Error(`user/installations: HTTP ${res.status}`);
    const data = (await res.json()) as { installations: Array<{ id: number }> };
    ids.push(...data.installations.map((i) => i.id));
    if (data.installations.length < 100) break;
  }
  return ids;
}
