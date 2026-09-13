import { bearerMatches } from "../../../src/auth/access.ts";
import { anthropicLlm } from "../../../src/evalgen/extract.ts";
import { mailConfigured } from "../../../src/notify.ts";

/**
 * Proves the write-only keys work from inside the deployment, where they can
 * be read. Vercel marks them Sensitive, so `vercel env pull` returns them
 * blank and nothing outside the app can tell a bad key from a good one: a
 * dead ANTHROPIC_API_KEY silently skips every eval pack, a dead
 * GITHUB_SEARCH_TOKEN leaves /dead frozen at its last count, and a MAIL_FROM
 * on a domain Resend has not verified fails every send with a 403 while the
 * variables look fine. The mail probe asks Resend about the sender's domain.
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

async function probeMail(): Promise<Probe> {
  if (!mailConfigured()) return { ok: false, error: "RESEND_API_KEY or MAIL_FROM is not set" };
  const domain = /@([^>\s]+)/.exec(process.env.MAIL_FROM ?? "")?.[1];
  if (!domain) return { ok: false, error: "MAIL_FROM carries no address" };
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
  } catch (e) {
    return { ok: false, error: `resend unreachable: ${(e as Error).message.slice(0, 200)}` };
  }
  if (!res.ok) return { ok: false, error: `resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const data = (await res.json()) as { data?: Array<{ name?: string; status?: string }> };
  const row = data.data?.find((d) => d.name === domain);
  if (!row) return { ok: false, error: `${domain} is not a domain in the Resend account` };
  if (row.status !== "verified") return { ok: false, error: `${domain} is ${row.status ?? "unknown"} at Resend, not verified` };
  return { ok: true, detail: `${domain} verified at Resend` };
}

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization"), secret)) {
    return new Response("unauthorized", { status: 401 });
  }
  const [anthropic, search, mail] = await Promise.all([probeAnthropic(), probeSearch(), probeMail()]);
  return Response.json({ anthropic, search, mail });
}
