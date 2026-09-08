/**
 * GitHub OAuth (web application flow) helpers. Pure functions over env +
 * fetch so tests can inject a fetchImpl and never touch the network.
 */

export function buildAuthorizeUrl(state: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) throw new Error("GITHUB_CLIENT_ID must be set");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${process.env.APP_URL ?? "http://localhost:3000"}/api/auth/callback`);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!res.ok) throw new Error(`oauth token exchange: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`oauth token exchange: ${data.error ?? "no access_token"}`);
  return data.access_token;
}

export async function fetchViewer(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ login: string; id: number }> {
  const res = await fetchImpl("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GET /user: HTTP ${res.status}`);
  const data = (await res.json()) as { login: string; id: number };
  return { login: data.login, id: data.id };
}

/** Revoke a user token at GitHub (sign-out). Basic auth is the App's OAuth client id and secret. */
export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const basic = Buffer.from(`${clientId}:${process.env.GITHUB_CLIENT_SECRET}`).toString("base64");
  const res = await fetchImpl(`https://api.github.com/applications/${clientId}/token`, {
    method: "DELETE",
    headers: {
      authorization: `Basic ${basic}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({ access_token: token }),
  });
  if (!res.ok) throw new Error(`token revoke: HTTP ${res.status}`);
}
