// aidep: builds evals/tests.baseline.json from the baseline promptfoo run.
// Reads evals/baseline.json (promptfoo --output json) + evals/tests.json,
// attaches asserts to every test: deterministic checks first, then
// similar/factuality against the baseline output. No dependencies.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const baseline = JSON.parse(readFileSync(join(here, "baseline.json"), "utf8"));
const tests = JSON.parse(readFileSync(join(here, "tests.json"), "utf8"));

function asText(output) {
  if (typeof output === "string") return output;
  if (output == null) return null;
  return JSON.stringify(output);
}

// promptfoo 0.12x --output json: { results: { results: [...] } } where each
// row has { testIdx, testCase, vars, response: { output } }. Older outputs
// carry { results: { table: { body: [...] } } } instead; read both.
function baselineRows(data) {
  const rows = data?.results?.results;
  if (Array.isArray(rows)) {
    return rows.map((r, i) => ({
      testIdx: typeof r?.testIdx === "number" ? r.testIdx : i,
      description: r?.testCase?.description ?? r?.description ?? null,
      output: asText(r?.response?.output),
    }));
  }
  const body = data?.results?.table?.body;
  if (Array.isArray(body)) {
    return body.map((row, i) => ({
      testIdx: i,
      description: row?.test?.description ?? null,
      output: asText(row?.outputs?.[0]?.text ?? row?.outputs?.[0]),
    }));
  }
  return [];
}

const rows = baselineRows(baseline);

function baselineOutputFor(test, index) {
  const byIdx = rows.find((r) => r.testIdx === index);
  if (byIdx && byIdx.output != null) return byIdx.output;
  const byDesc = rows.find((r) => r.description != null && r.description === test.description);
  if (byDesc && byDesc.output != null) return byDesc.output;
  return rows[index]?.output ?? null;
}

const withAsserts = tests.map((test, index) => {
  const checks = test.__checks ?? {};
  const asserts = [];
  if (checks.json) asserts.push({ type: "is-json" });
  if (Array.isArray(checks.oneOf) && checks.oneOf.length > 0) {
    // JSON.stringify keeps the list a safe JS array literal inside the expression.
    asserts.push({ type: "javascript", value: `${JSON.stringify(checks.oneOf)}.includes(output.trim())` });
  }
  if (typeof checks.contains === "string" && checks.contains.length > 0) {
    asserts.push({ type: "contains", value: checks.contains });
  }
  const baselineOutput = baselineOutputFor(test, index);
  if (baselineOutput != null) {
    asserts.push({ type: "similar", value: baselineOutput, threshold: 0.8 });
    asserts.push({ type: "factuality", value: baselineOutput });
  }
  return { description: test.description, vars: test.vars, assert: asserts };
});

writeFileSync(join(here, "tests.baseline.json"), JSON.stringify(withAsserts, null, 2) + "\n");
console.log(`build-asserts: wrote ${withAsserts.length} tests to tests.baseline.json`);
