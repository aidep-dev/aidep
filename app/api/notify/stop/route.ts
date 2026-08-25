import { z } from "zod";
import { confirmTokenMatches, suppressAddress } from "../../../../src/notify.ts";

/**
 * The one-click stop link in every mail footer. A valid HMAC for the address
 * suppresses it permanently: no digests, no waitlist mail, not even the
 * confirmation mail. Same token as the confirm link; holding the link proves
 * control of the mailbox. Plain text back, same as confirm.
 */
const Query = z.object({ e: z.string().email().max(200), t: z.string().min(1).max(200) });

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = Query.safeParse({ e: url.searchParams.get("e"), t: url.searchParams.get("t") });
  if (!q.success || !confirmTokenMatches(q.data.e, q.data.t)) {
    return new Response("that link is not valid", { status: 400 });
  }
  await suppressAddress(q.data.e);
  return new Response(
    `Done. aidep will never mail ${q.data.e.toLowerCase()} again.\n`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
