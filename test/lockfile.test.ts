import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `@tailwindcss/oxide-wasm32-wasi` and `@img/sharp-wasm32` need hoisted
 * `@emnapi/core` and `@emnapi/runtime` entries. npm on macOS never resolves
 * them, because it skips optional packages for other platforms, so a plain
 * `npm install` here silently drops them and `npm ci` then refuses on Linux
 * with "Missing: @emnapi/runtime from lock file". That has broken CI twice.
 *
 * If this fails, regenerate the lock on Linux rather than editing it by hand:
 *
 *   docker run --rm -v "$PWD":/app -w /app node:24 npm install --package-lock-only
 */
const REQUIRED = ["node_modules/@emnapi/core", "node_modules/@emnapi/runtime"];

describe("package-lock.json", () => {
  it("keeps the hoisted wasm32 entries that npm ci needs on Linux", () => {
    const path = fileURLToPath(new URL("../package-lock.json", import.meta.url));
    const packages = JSON.parse(readFileSync(path, "utf8")).packages as Record<string, unknown>;
    for (const key of REQUIRED) {
      expect(packages, `${key} missing; regenerate the lock on Linux`).toHaveProperty(key);
    }
  });
});
