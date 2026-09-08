import { z } from "zod";
import { confirmTokenMatches, suppressAddress } from "../../../../src/notify.ts";

/**
 * The stop link in every mail footer and List-Unsubscribe header. GET is a
 * page with one button and writes nothing, so a link scanner that follows
 * every URL in a mail cannot stop an address on someone's behalf. POST
 * suppresses it permanently: no digests, no waitlist mail, not even the
 * confirmation mail. The POST comes from that button or from the mail
 * client's own unsubscribe button (RFC 8058, body `List-Unsubscribe=One-Click`);
 * both carry e and t in the URL, so the body is never read. Same token as
 * the confirm link; holding the link proves control of the mailbox. Plain
 * text back from the POST.
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
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Stop aidep mail</title>
<form method="post"><p>Stop all aidep mail to ${email}? One button, nothing else asked, and it cannot be undone.</p><button>Stop all mail to this address</button></form>
`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(req: Request): Promise<Response> {
  const email = addressFrom(req);
  if (email === null) return invalid();
  await suppressAddress(email);
  return new Response(`Done. aidep will never mail ${email} again.\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
