import { z } from "zod";
import { RegistryRowSchema } from "../../../../src/registry.ts";

/** JSON Schema for one registry row, derived from the zod schema so it cannot drift. */
export const dynamic = "force-static";

export function GET(): Response {
  const schema = z.toJSONSchema(RegistryRowSchema);
  return Response.json(
    { ...schema, $id: "https://aidep.dev/api/registry/schema.json", title: "aidep registry row" },
    { headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } },
  );
}
