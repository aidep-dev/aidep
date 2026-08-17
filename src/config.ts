import { z } from "zod";

/** .github/aidep.json; deliberately tiny. */
export const AidepConfigSchema = z
  .object({
    schedule: z.enum(["daily", "weekly"]).default("daily"),
    ignore: z.array(z.string().max(200)).max(100).default([]),
    prCap: z.number().int().min(1).max(20).default(3),
    evals: z.boolean().default(false),
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
