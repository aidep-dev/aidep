import { getApp } from "./app.ts";
import type { OctokitLike } from "./types.ts";

/**
 * Single seam for obtaining an installation-scoped octokit. Both the webhook
 * handlers and the job pipeline go through here so tests can mock one module.
 */
export async function installationOctokit(installationId: number): Promise<OctokitLike> {
  const octokit = await getApp().getInstallationOctokit(installationId);
  // SAFETY: a real installation Octokit implements request() with a far more
  // overloaded signature than OctokitLike states; this narrows to the subset
  // the app actually calls, which test recorders implement too.
  return octokit as OctokitLike;
}
