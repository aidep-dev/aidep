import { App } from "octokit";

let app: App | null = null;

export function getApp(): App {
  if (!app) {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!appId || !privateKey || !secret) {
      throw new Error("GITHUB_APP_ID, GITHUB_PRIVATE_KEY, and GITHUB_WEBHOOK_SECRET must be set");
    }
    app = new App({ appId, privateKey, webhooks: { secret } });
  }
  return app;
}

/** Test seam: inject a fake App and reset between tests. */
export function setAppForTesting(fake: App | null): void {
  app = fake;
}
