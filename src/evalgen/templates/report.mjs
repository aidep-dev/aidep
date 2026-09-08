// aidep: turns the assert run (evals/run.json, promptfoo --output json) into
// evals/results.json, commits it to the current branch, and posts/updates a
// PR comment. The verdict is a signal, not a gate: this script always exits 0.
// --dry-run: print the results.json object to stdout and skip file writes,
// git, and network; used by aidep's own tests and handy for local debugging.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");
const MARKER = "<!-- aidep-eval-report -->";

function runRows(data) {
  const rows = data?.results?.results;
  if (Array.isArray(rows)) return rows;
  const body = data?.results?.table?.body;
  if (Array.isArray(body)) {
    return body.map((row) => ({
      testCase: row?.test,
      error: row?.outputs?.[0]?.error ?? null,
      gradingResult: row?.outputs?.[0]?.gradingResult ?? null,
    }));
  }
  return [];
}

// held: every assert passed. drifted: any assert failed (similar/factuality
// failing is the drift signal; a deterministic check failing is drift too).
// inconclusive: the row errored or has no grading result.
function verdictFor(row) {
  if (!row || row.error) {
    return { verdict: "inconclusive", details: row?.error ? String(row.error).slice(0, 300) : "missing result" };
  }
  const comps = row.gradingResult?.componentResults;
  if (!Array.isArray(comps) || comps.length === 0) {
    if (row.gradingResult?.pass === true || row.success === true) return { verdict: "held", details: "" };
    return { verdict: "inconclusive", details: "no assert results" };
  }
  const failed = comps.filter((c) => c && c.pass === false);
  if (failed.length === 0) return { verdict: "held", details: "" };
  const types = failed.map((c) => c?.assertion?.type ?? "unknown");
  return { verdict: "drifted", details: `failed: ${types.join(", ")}` };
}

function buildResults(run) {
  const rows = runRows(run);
  const cases = rows.map((row, i) => {
    const { verdict, details } = verdictFor(row);
    return {
      description: row?.testCase?.description ?? row?.description ?? `case ${i + 1}`,
      verdict,
      details,
    };
  });
  const summary = {
    held: cases.filter((c) => c.verdict === "held").length,
    drifted: cases.filter((c) => c.verdict === "drifted").length,
    inconclusive: cases.filter((c) => c.verdict === "inconclusive").length,
    total: cases.length,
  };
  const judge = run?.config?.defaultTest?.options?.provider ?? "unknown";
  return { judge, summary, cases };
}

function prNumber() {
  const m = /^refs\/pull\/(\d+)\//.exec(process.env.GITHUB_REF ?? "");
  if (m) return Number(m[1]);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8"));
      const n = event?.pull_request?.number ?? event?.number;
      if (typeof n === "number") return n;
    } catch {
      // fall through
    }
  }
  return null;
}

function commentBody(results) {
  const lines = results.cases.map(
    (c) => `- ${c.verdict}: ${c.description}${c.details ? ` (${c.details})` : ""}`,
  );
  return [
    MARKER,
    `aidep eval: behavior held on ${results.summary.held}/${results.summary.total} prompts` +
      ` (judge: ${results.judge}).`,
    "",
    ...lines,
    "",
  ].join("\n");
}

async function upsertComment(results) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = prNumber();
  if (!token || !repo || pr == null) {
    console.error("report: missing GITHUB_TOKEN / GITHUB_REPOSITORY / PR number, skipping comment");
    return;
  }
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
  };
  const body = JSON.stringify({ body: commentBody(results) });
  const listRes = await fetch(
    `https://api.github.com/repos/${repo}/issues/${pr}/comments?per_page=100`,
    { headers },
  );
  const existing = listRes.ok
    ? (await listRes.json()).find((c) => typeof c?.body === "string" && c.body.includes(MARKER))
    : undefined;
  if (existing) {
    await fetch(`https://api.github.com/repos/${repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      headers,
      body,
    });
  } else {
    await fetch(`https://api.github.com/repos/${repo}/issues/${pr}/comments`, {
      method: "POST",
      headers,
      body,
    });
  }
}

function commitResults(resultsPath) {
  const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git("add", resultsPath);
  git("commit", "-m", "aidep: record eval results");
  // the checkout keeps no credentials, so the push carries the job token itself
  const auth = Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN ?? ""}`).toString("base64");
  git("-c", `http.extraheader=AUTHORIZATION: basic ${auth}`, "push", "origin", "HEAD");
}

try {
  const run = JSON.parse(readFileSync(join(here, "run.json"), "utf8"));
  const results = buildResults(run);
  if (dryRun) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const resultsPath = join(here, "results.json");
    writeFileSync(resultsPath, JSON.stringify(results, null, 2) + "\n");
    try {
      commitResults(resultsPath);
    } catch (e) {
      console.error("report: git commit/push failed:", e instanceof Error ? e.message : e);
    }
    try {
      await upsertComment(results);
    } catch (e) {
      console.error("report: PR comment failed:", e instanceof Error ? e.message : e);
    }
    console.log(`report: behavior held on ${results.summary.held}/${results.summary.total} prompts`);
  }
} catch (e) {
  console.error("report: failed:", e instanceof Error ? e.message : e);
}
process.exit(0);
