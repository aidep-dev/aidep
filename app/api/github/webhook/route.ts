import { after } from "next/server.js";
import { getApp } from "../../../../src/github/app.ts";
import { registerHandlers } from "../../../../src/github/handlers.ts";
import { drain } from "../../../../src/jobs.ts";
import { runJob } from "../../../../src/pipeline.ts";

/** Schedule the queue drain post-response. Outside a Next request scope
 * (plain vitest) after() throws; there we skip the drain entirely — a
 * fallback drain in tests would claim other test files' queued jobs. The
 * cron drain covers anything a missed kick leaves behind. */
function kick(): void {
  try {
    after(() => drain(runJob));
  } catch {
    if (!process.env.VITEST) void drain(runJob).catch(() => {});
  }
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const app = getApp();
  registerHandlers(app); // idempotent per App instance

  try {
    await app.webhooks.verifyAndReceive({
      id: req.headers.get("x-github-delivery") ?? "",
      // GitHub sends the event name; verifyAndReceive validates it
      name: (req.headers.get("x-github-event") ?? "") as never,
      signature: req.headers.get("x-hub-signature-256") ?? "",
      payload: body,
    });
  } catch {
    return new Response("bad signature", { status: 401 });
  }

  kick();
  return new Response("ok");
}
