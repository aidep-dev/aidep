import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.ts";
import { RegistryRowSchema } from "../src/registry.ts";

describe("parseConfig ignore bounds", () => {
  it("falls back to defaults when ignore exceeds 100 globs", () => {
    const raw = JSON.stringify({ ignore: Array.from({ length: 500 }, (_, i) => `g${i}/**`) });
    const { config, error } = parseConfig(raw);
    expect(error).not.toBeNull();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("accepts a handful of globs", () => {
    const globs = ["dist/**", "*.min.js", "vendor/**", "node_modules/**", "build/**"];
    const { config, error } = parseConfig(JSON.stringify({ ignore: globs }));
    expect(error).toBeNull();
    expect(config.ignore).toEqual(globs);
  });
});

describe("registry migration_url scheme", () => {
  const base = {
    id: "openai:endpoint:assistants-api",
    provider: "openai",
    surface: "endpoint",
    api_ids: ["/v1/assistants"],
    status: "deprecated",
    announced: "2025-08-26",
    dies: "2026-08-26",
    dies_is_earliest_possible: false,
    replacement_id: null,
    replacement_notes: null,
    source_url: "https://platform.openai.com/docs/deprecations",
    verified_at: "2026-08-01",
    platform: "first-party",
  } as const;

  it("rejects a non-https migration_url", () => {
    expect(RegistryRowSchema.safeParse({ ...base, migration_url: "http://x.example/m" }).success).toBe(false);
    expect(RegistryRowSchema.safeParse({ ...base, migration_url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("accepts https and null", () => {
    expect(RegistryRowSchema.safeParse({ ...base, migration_url: "https://x.example/m" }).success).toBe(true);
    expect(RegistryRowSchema.safeParse({ ...base, migration_url: null }).success).toBe(true);
  });
});
