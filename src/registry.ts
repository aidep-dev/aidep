import { readFile } from "node:fs/promises";
import { z } from "zod";

// Mirror of aidep-registry/src/schema.ts. The registry repo owns the schema;
// keep this in sync when a field changes there.
export const RegistryRowSchema = z.object({
  id: z.string().regex(/^(openai|anthropic|google):(model|endpoint|param|header|feature):[a-z0-9][a-z0-9.-]*$/),
  provider: z.enum(["openai", "anthropic", "google"]),
  surface: z.enum(["model", "endpoint", "param", "header", "feature"]),
  api_ids: z.array(z.string().min(1)).min(1),
  status: z.enum(["legacy", "deprecated", "retired"]),
  announced: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dies: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dies_is_earliest_possible: z.boolean(),
  replacement_id: z.string().nullable(),
  replacement_notes: z.string().nullable(),
  migration_url: z.url().nullable(),
  source_url: z.url(),
  verified_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  platform: z.literal("first-party"),
});

export type RegistryRow = z.infer<typeof RegistryRowSchema>;

const RegistryFileSchema = z.array(RegistryRowSchema);

let cache: { source: string; rows: RegistryRow[] } | null = null;

/**
 * Load the full registry (all providers merged).
 * REGISTRY_SOURCE is either a local directory containing openai.json /
 * anthropic.json / google.json (dev: ../aidep-registry/registry) or an
 * https:// base URL serving the same three files (prod: raw.githubusercontent).
 */
export async function loadRegistry(source = process.env.REGISTRY_SOURCE ?? "../aidep-registry/registry"): Promise<RegistryRow[]> {
  if (cache?.source === source) return cache.rows;
  const files = ["openai.json", "anthropic.json", "google.json"];
  const rows: RegistryRow[] = [];
  for (const f of files) {
    const raw = source.startsWith("https://")
      ? await (await fetch(`${source.replace(/\/$/, "")}/${f}`)).text()
      : await readFile(`${source}/${f}`, "utf8");
    rows.push(...RegistryFileSchema.parse(JSON.parse(raw)));
  }
  cache = { source, rows };
  return rows;
}
