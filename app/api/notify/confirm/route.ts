import { z } from "zod";
import { sql } from "../../../../src/db/index.ts";
import { confirmAddress, confirmTokenMatches, WAITLIST_WINDOW_DAYS } from "../../../../src/notify.ts";

/**
 * The link in the one confirmation mail. GET is a page with one button and
 * writes nothing, so a link scanner that follows every URL in the mail
 * cannot consent on someone's behalf. POST, from that button, checks the
 * same HMAC and marks the address confirmed; after that, and only after
 * that, digests and waitlist mail go to it. Plain text back from the POST.
 */
const Query = z.object({ e: z.string().email().max(200), t: z.string().min(1).max(200) });

function addressFrom(req: Request): string | null {
  const url = new URL(req.url);
  const q = Query.safeParse({ e: url.searchParams.get("e"), t: url.searchParams.get("t") });
  return q.success && confirmTokenMatches(q.data.e, q.data.t) ? q.data.e.toLowerCase() : null;
}

const invalid = () => new Response("that link is not valid", { status: 400 });

export async function GET(req: Request): Promise<Response> {
  const email = addressFrom(req);
  if (email === null) return invalid();
  // The form posts back to this URL, so e and t ride along in the query.
  // zod's email regex admits no & < > ", so the address is safe in markup.
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Confirm your address for aidep</title>
<form method="post"><p>Confirm ${email} for aidep mail? One button, nothing else asked.</p><button>Confirm this address</button></form>
`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(req: Request): Promise<Response> {
  const email = addressFrom(req);
  if (email === null) return invalid();
  await confirmAddress(email);
  const [{ waitlist, notify }] = await sql<{ waitlist: boolean; notify: boolean }[]>`
    select
      exists (select 1 from interest where source = 'landing-waitlist' and lower(email) = ${email}) as waitlist,
      exists (
        select 1 from repos r, jsonb_array_elements_text(coalesce(r.config->'notify', '[]'::jsonb)) a
        where lower(a) = ${email}) as notify`;
  const reasons = [
    ...(notify ? ["when a scan finds a new exposure or a retirement date gets close"] : []),
    ...(waitlist ? [`when a retirement date is inside ${WAITLIST_WINDOW_DAYS} days`] : []),
  ];
  const stop = notify
    ? "Remove the address from .github/aidep.json to stop, or use the stop button every mail links to."
    : "Every mail links to a stop button.";
  return new Response(
    `Confirmed. aidep will write to ${email} ${reasons.length > 0 ? reasons.join(", and ") : "when it matters"}, and for nothing else. ${stop}\n`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
