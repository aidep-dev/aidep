import { describe, expect, it } from "vitest";
import { isDyingModel, judgeProviderFor } from "../src/github/migration.ts";
import { loadRegistry } from "../src/registry.ts";

// Deliberately NOT mocking the registry: the point of this file is to check
// our hardcoded judge candidates against the live deprecation data. Shipping
// an eval judged by a dying model is the exact bug aidep sells against, so it
// fails the build rather than shipping.
describe("judge selection against the real registry", () => {
  it("never pins a judge the registry knows is deprecated or retired", async () => {
    const rows = await loadRegistry();
    expect(rows.length).toBeGreaterThan(50); // guard: a stubbed/empty registry would pass vacuously
    for (const provider of ["openai", "anthropic", "google"] as const) {
      const judge = judgeProviderFor(provider, rows);
      const model = judge.split(":").pop()!;
      expect(isDyingModel(model, rows), `${judge} is dying per the registry`).toBe(false);
    }
  });

  it("pins a different model family than the one under test", async () => {
    const rows = await loadRegistry();
    expect(judgeProviderFor("openai", rows).startsWith("anthropic:")).toBe(true);
    expect(judgeProviderFor("anthropic", rows).startsWith("openai:")).toBe(true);
    expect(judgeProviderFor("google", rows).startsWith("openai:")).toBe(true);
  });
});
