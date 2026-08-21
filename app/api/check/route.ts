import { bearerMatches } from "../../../src/auth/access.ts";
import { anthropicLlm } from "../../../src/evalgen/extract.ts";

/**
 * Proves the two write-only keys work from inside the deployment, where
 * they can be read. Vercel marks them Sensitive, so `vercel env pull` returns
 * them blank and nothing outside the app can tell a bad key from a good one:
 * a dead ANTHROPIC_API_KEY silently skips every eval pack, and a dead
 * GITHUB_SEARCH_TOKEN leaves /dead frozen at its last count.
 *
 *   curl -H "authorization: Bearer $CRON_SECRET" https://aidep.dev/api/check
 */

type Probe = { ok: true; detail: string } | { ok: false; error: string };

async function probeAnthropic(): Promise<Probe> {
  try {
    const reply = await anthropicLlm()("Reply with the single word: ok", "ok");
    return { ok: true, detail: reply.trim().slice(0, 20) };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

async function probeSearch(): Promise<Probe> {
  const token = process.env.GITHUB_SEARCH_TOKEN;
  if (!token) return { ok: false, error: "GITHUB_SEARCH_TOKEN is not set" };
  const res = await fetch("https://api.github.com/search/code?q=%22client.beta.threads%22&per_page=1", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) return { ok: false, error: `github ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const data = (await res.json()) as { total_count?: number };
  return { ok: true, detail: `${data.total_count} files match` };
}

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization"), secret)) {
    return new Response("unauthorized", { status: 401 });
  }
  const [anthropic, search] = await Promise.all([probeAnthropic(), probeSearch()]);
  return Response.json({ anthropic, search });
}
