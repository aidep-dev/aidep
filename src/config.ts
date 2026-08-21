import { z } from "zod";

/** .github/aidep.json; deliberately tiny. */
export const AidepConfigSchema = z
  .object({
    schedule: z.enum(["daily", "weekly"]).default("daily"),
    ignore: z.array(z.string().max(200)).max(100).default([]),
    // 5 matches Dependabot's open-pull-requests-limit. Urgent retirements are
    // exempt from it (see isUrgentEvent), the way both Dependabot and Renovate
    // exempt security updates from theirs.
    prCap: z.number().int().min(1).max(20).default(5),
    evals: z.boolean().default(false),
    // Who to email about this repo: new exposures after a scan, and
    // retirements inside the 30-day window. The only push channel. Comes
    // from the file the owner merges, never from GitHub; reading the
    // installer's address would be a fourth permission.
    notify: z.array(z.string().email().max(200)).max(5).default([]),
  })
  .strict();

export type AidepConfig = z.infer<typeof AidepConfigSchema>;

export const DEFAULT_CONFIG: AidepConfig = AidepConfigSchema.parse({});

/** Parse customer config; hostile/invalid input falls back to defaults. */
export function parseConfig(raw: string): { config: AidepConfig; error: string | null } {
  try {
    return { config: AidepConfigSchema.parse(JSON.parse(raw)), error: null };
  } catch (e) {
    return { config: DEFAULT_CONFIG, error: e instanceof Error ? e.message.slice(0, 500) : "invalid config" };
  }
}
