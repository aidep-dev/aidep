import { readFileSync } from "node:fs";
import type { EvalPackInput, GeneratedFile } from "./types.ts";

/** All JSON goes through JSON.stringify; never string templates; so repo-derived
 * strings cannot break out of their value position (injection-safe by construction). */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Runtime files are static templates emitted verbatim: zero interpolation,
 * zero injection surface. A test asserts byte-identity with these files. */
function template(name: string): string {
  return readFileSync(new URL(`./templates/${name}`, import.meta.url), "utf8");
}

/**
 * Build the eval pack shipped inside a migration PR. promptfoo resolves
 * file:// paths relative to the config file, and every config lives in
 * evals/, so bare file://prompts.json style paths are correct.
 * No prompt objects anywhere: the Prompts API dies 2026-11-30, so prompts
 * are always inlined in prompts.json.
 */
export function generateEvalPack(input: EvalPackInput): GeneratedFile[] {
  const tests = input.cases.flatMap((c) => {
    const sets = c.vars.length > 0 ? c.vars : [{}];
    return sets.map((vars, i) => ({
      description: sets.length > 1 ? `${c.description} [${i + 1}]` : c.description,
      vars,
      __checks: c.checks,
    }));
  });

  const prompts = [...new Set(input.cases.map((c) => c.prompt))];

  const baselineConfig = {
    description: `aidep baseline: ${input.oldModelId}`,
    prompts: ["file://prompts.json"],
    providers: [input.oldProvider],
    tests: "file://tests.json",
  };

  // tests.baseline.json is written in CI by build-asserts.mjs after the baseline run.
  const evalConfig = {
    description: `aidep eval: ${input.oldModelId} -> ${input.newModelId}`,
    prompts: ["file://prompts.json"],
    providers: [input.newProvider],
    tests: "file://tests.baseline.json",
    defaultTest: { options: { provider: input.judgeProvider } },
  };

  return [
    { path: "evals/tests.json", content: json(tests) },
    { path: "evals/prompts.json", content: json(prompts) },
    { path: "evals/promptfooconfig.baseline.json", content: json(baselineConfig) },
    { path: "evals/promptfooconfig.json", content: json(evalConfig) },
    { path: "evals/build-asserts.mjs", content: template("build-asserts.mjs") },
    { path: "evals/report.mjs", content: template("report.mjs") },
    { path: "evals/workflows/aidep-eval.yml", content: template("aidep-eval.yml") },
  ];
}
