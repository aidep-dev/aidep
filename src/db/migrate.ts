import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "./index.ts";

export async function migrate(): Promise<void> {
  const schema = readFileSync(fileURLToPath(new URL("../../db/schema.sql", import.meta.url)), "utf8");
  await sql.unsafe(schema);
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  migrate()
    .then(() => {
      console.log("schema applied");
      return sql.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
