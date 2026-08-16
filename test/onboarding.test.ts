import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { buildOnboardingPr, openOnboardingPr } from "../src/github/onboarding.ts";
import type { OnboardingPrContent } from "../src/github/onboarding.ts";
import type { OctokitLike, RepoTarget } from "../src/github/types.ts";
import { scanFiles } from "../src/scanner/scan.ts";
import type { ScanFile } from "../src/scanner/types.ts";
import { MINI_REGISTRY } from "./mini-registry.ts";

process.env.APP_URL = "https://aidep.test";

const repo: RepoTarget = { owner: "acme", name: "widgets", defaultBranch: "main" };
const NOW = "2026-08-16";

const fixtureFiles: ScanFile[] = [
  { path: "src/agent.py", text: 'model = "gpt-4-turbo"\nresp = client.post("/v1/assistants")\n' },
  { path: ".github/workflows/nightly.yml", text: "model: gemini-2.0-flash-001\n" },
  { path: "src/claude.ts", text: 'const m = "claude-3-5-sonnet-20241022";\n' },
];

function build(files: ScanFile[]): OnboardingPrContent {
  return buildOnboardingPr({ repo, result: scanFiles(files, MINI_REGISTRY), rows: MINI_REGISTRY, now: NOW });
}

describe("buildOnboardingPr", () => {
  const content = build(fixtureFiles);

  it("returns the fixed branch/title/path and default config with trailing newline", () => {
    expect(content.branch).toBe("aidep/configure");
    expect(content.title).toBe("Configure aidep");
    expect(content.configPath).toBe(".github/aidep.json");
    expect(content.configContent).toBe(JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  });

  it("renders sections in order", () => {
    const order = [
      "Welcome to aidep! This PR sets up deprecation monitoring for your AI provider dependencies. aidep does nothing else until you merge it.",
      "Merge this PR to activate aidep. Close it unmerged to disable aidep on this repo.",
      "## What we found",
      "## What happens after you merge",
      "## Config",
      "Questions? https://aidep.test/docs",
      "- [ ] <!-- aidep-rebase -->",
      "<!-- aidep:body-hash:",
    ];
    const positions = order.map((s) => content.body.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("embeds the exposure report without the h1/repo header", () => {
    expect(content.body).not.toContain("# aidep scan report");
    expect(content.body).not.toContain("Repo:");
    expect(content.body).toContain("**retired 2025-10-28 — calls fail today**");
    expect(content.body).toContain("dies 2026-08-26 (10 days)");
    expect(content.body).toContain("dies 2026-10-23 (68 days) (earliest possible date)");
    expect(content.body).toContain(
      ".github/workflows/nightly.yml: workflow file — aidep will not edit this path; migrate manually",
    );
    expect(content.body).toContain("Files scanned: 3, skipped: 0");
  });

  it("has the exact rebase checkbox line", () => {
    expect(content.body).toContain(
      "- [ ] <!-- aidep-rebase -->If you want aidep to re-run the scan and refresh this PR, check this box.",
    );
  });

  it("ends with a body-hash comment matching the sha256 of the body above it", () => {
    const m = content.body.match(/\n<!-- aidep:body-hash:([0-9a-f]{64}) -->$/);
    expect(m).not.toBeNull();
    const pre = content.body.slice(0, content.body.length - m![0].length);
    expect(createHash("sha256").update(pre, "utf8").digest("hex")).toBe(m![1]);
  });

  it("renders the clean-bill section when there are zero findings", () => {
    const clean = build([{ path: "src/ok.ts", text: "const x = 1;\n" }]);
    expect(clean.body).toContain(
      "No exposures today. aidep keeps watching: the registry updates as providers announce retirements.",
    );
    expect(clean.body).not.toContain("| file | line | matched |");
  });

  it("neutralizes markdown in hostile file paths", () => {
    const hostile = build([{ path: "evil](x.md)|<script>src.py", text: 'model = "gpt-4-turbo"\n' }]);
    expect(hostile.body).toContain("| evil\\](x.md)\\|\\<script\\>src.py | 1 | gpt-4-turbo |");
    expect(hostile.body).not.toContain("<script>");
    expect(hostile.body).not.toContain("evil](x.md)");
  });

  it("matches snapshot", () => {
    expect(content.body).toMatchSnapshot();
  });
});

type Params = Record<string, unknown> | undefined;
type Handler = (params: Params) => { data: unknown; status?: number };

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function makeOctokit(handlers: Record<string, Handler>) {
  const calls: Array<{ route: string; params: Params }> = [];
  const octokit: OctokitLike = {
    request(route, params) {
      calls.push({ route, params });
      const h = handlers[route];
      if (h === undefined) return Promise.reject(new Error(`unexpected route: ${route}`));
      try {
        return Promise.resolve(h(params));
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
  return { octokit, calls };
}

describe("openOnboardingPr", () => {
  const content = build(fixtureFiles);

  it("happy path: creates branch, commits config, opens PR", async () => {
    const { octokit, calls } = makeOctokit({
      "GET /repos/{owner}/{repo}/git/ref/{ref}": () => ({ data: { object: { sha: "base-sha" } } }),
      "POST /repos/{owner}/{repo}/git/refs": () => ({ data: {}, status: 201 }),
      "GET /repos/{owner}/{repo}/contents/{path}": () => {
        throw httpError(404, "Not Found");
      },
      "PUT /repos/{owner}/{repo}/contents/{path}": () => ({ data: {} }),
      "POST /repos/{owner}/{repo}/pulls": () => ({ data: { number: 42 } }),
    });

    const number = await openOnboardingPr(octokit, repo, content);
    expect(number).toBe(42);
    expect(calls.map((c) => c.route)).toEqual([
      "GET /repos/{owner}/{repo}/git/ref/{ref}",
      "POST /repos/{owner}/{repo}/git/refs",
      "GET /repos/{owner}/{repo}/contents/{path}",
      "PUT /repos/{owner}/{repo}/contents/{path}",
      "POST /repos/{owner}/{repo}/pulls",
    ]);
    expect(calls[0].params).toEqual({ owner: "acme", repo: "widgets", ref: "heads/main" });
    expect(calls[1].params).toEqual({
      owner: "acme",
      repo: "widgets",
      ref: "refs/heads/aidep/configure",
      sha: "base-sha",
    });
    expect(calls[3].params).toEqual({
      owner: "acme",
      repo: "widgets",
      path: ".github/aidep.json",
      message: "Add aidep config",
      content: Buffer.from(content.configContent, "utf8").toString("base64"),
      branch: "aidep/configure",
    });
    expect(calls[4].params).toEqual({
      owner: "acme",
      repo: "widgets",
      title: "Configure aidep",
      head: "aidep/configure",
      base: "main",
      body: content.body,
    });
  });

  it("branch already exists: continues and updates the existing file with its sha", async () => {
    const { octokit, calls } = makeOctokit({
      "GET /repos/{owner}/{repo}/git/ref/{ref}": () => ({ data: { object: { sha: "base-sha" } } }),
      "POST /repos/{owner}/{repo}/git/refs": () => {
        throw httpError(422, "Reference already exists");
      },
      "GET /repos/{owner}/{repo}/contents/{path}": () => ({ data: { sha: "old-file-sha" } }),
      "PUT /repos/{owner}/{repo}/contents/{path}": () => ({ data: {} }),
      "POST /repos/{owner}/{repo}/pulls": () => ({ data: { number: 43 } }),
    });

    const number = await openOnboardingPr(octokit, repo, content);
    expect(number).toBe(43);
    const put = calls.find((c) => c.route === "PUT /repos/{owner}/{repo}/contents/{path}");
    expect(put?.params?.sha).toBe("old-file-sha");
  });

  it("PR already exists: looks up and returns the existing number", async () => {
    const { octokit, calls } = makeOctokit({
      "GET /repos/{owner}/{repo}/git/ref/{ref}": () => ({ data: { object: { sha: "base-sha" } } }),
      "POST /repos/{owner}/{repo}/git/refs": () => {
        throw httpError(422, "Reference already exists");
      },
      "GET /repos/{owner}/{repo}/contents/{path}": () => ({ data: { sha: "old-file-sha" } }),
      "PUT /repos/{owner}/{repo}/contents/{path}": () => ({ data: {} }),
      "POST /repos/{owner}/{repo}/pulls": () => {
        throw httpError(422, "Validation Failed: A pull request already exists for acme:aidep/configure.");
      },
      "GET /repos/{owner}/{repo}/pulls": () => ({ data: [{ number: 7 }] }),
    });

    const number = await openOnboardingPr(octokit, repo, content);
    expect(number).toBe(7);
    const list = calls.find((c) => c.route === "GET /repos/{owner}/{repo}/pulls");
    expect(list?.params).toEqual({
      owner: "acme",
      repo: "widgets",
      head: "acme:aidep/configure",
      state: "open",
    });
  });

  it("non-422 branch creation errors propagate", async () => {
    const { octokit } = makeOctokit({
      "GET /repos/{owner}/{repo}/git/ref/{ref}": () => ({ data: { object: { sha: "base-sha" } } }),
      "POST /repos/{owner}/{repo}/git/refs": () => {
        throw httpError(403, "Forbidden");
      },
    });
    await expect(openOnboardingPr(octokit, repo, content)).rejects.toThrow("Forbidden");
  });
});
