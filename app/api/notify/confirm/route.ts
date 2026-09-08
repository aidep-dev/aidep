import { z } from "zod";
import { sql } from "../../../../src/db/index.ts";
import {
  confirmAddress,
  linkTokenMatches,
  URGENT_WINDOW_DAYS,
  WAITLIST_WINDOW_DAYS,
  type ConsentScope,
} from "../../../../src/notify.ts";

/**
 * The link in the one confirmation mail. GET is a page with one button and
 * writes nothing, so a link scanner that follows every URL in the mail
 * cannot consent on someone's behalf. POST, from that button, checks the
 * same HMAC and marks the address confirmed for what the link names, one
 * repo or the waitlist; after that, and only after that, that repo's digests
 * or the waitlist mail go to it. Plain text back from the POST.
 */
const Scope = z.custom<ConsentScope>((v) => typeof v === "string" && /^(waitlist|repo:\d+)$/.test(v));
const Query = z.object({ e: z.string().email().max(200), s: Scope, t: z.string().min(1).max(200) });

function linkFrom(req: Request): { email: string; scope: ConsentScope } | null {
  const url = new URL(req.url);
  const q = Query.safeParse({
    e: url.searchParams.get("e"),
    s: url.searchParams.get("s"),
    t: url.searchParams.get("t"),
  });
  if (!q.success || !linkTokenMatches(q.data.e, q.data.s, q.data.t)) return null;
  return { email: q.data.e.toLowerCase(), scope: q.data.s };
}

const invalid = () => new Response("that link is not valid", { status: 400 });
const plain = (text: string) => new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(req: Request): Promise<Response> {
  const link = linkFrom(req);
  if (link === null) return invalid();
  // The form posts back to this URL, so e, s and t ride along in the query.
  // zod's email regex admits no & < > ", so the address is safe in markup.
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Confirm your address for aidep</title>
<form method="post"><p>Confirm ${link.email} for aidep mail? One button, nothing else asked.</p><button>Confirm this address</button></form>
`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(req: Request): Promise<Response> {
  const link = linkFrom(req);
  if (link === null) return invalid();
  await confirmAddress(link.email, link.scope);
  if (link.scope === "waitlist") {
    return plain(
      `Confirmed. aidep will write to ${link.email} when a retirement date is inside ${WAITLIST_WINDOW_DAYS} days, and for nothing else. Every mail links to a stop button.\n`,
    );
  }
  const [repo] = await sql<{ owner: string; name: string }[]>`
    select owner, name from repos where id = ${Number(link.scope.slice("repo:".length))}`;
  const of = repo ? ` of ${repo.owner}/${repo.name}` : "";
  return plain(
    `Confirmed. aidep will write to ${link.email} when a scan${of} finds a new exposure or a retirement is inside ${URGENT_WINDOW_DAYS} days, and for nothing else. Remove the address from .github/aidep.json to stop, or use the stop button every mail links to.\n`,
  );
}
