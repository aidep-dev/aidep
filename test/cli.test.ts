import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scan = fileURLToPath(new URL("../cli/scan.ts", import.meta.url));
// a registry path that does not exist: any run that gets as far as loading it fails
const run = (...args: string[]) =>
  spawnSync(process.execPath, [scan, ...args], {
    encoding: "utf8",
    env: { ...process.env, REGISTRY_SOURCE: "/nonexistent/registry" },
  });

describe("aidep cli arguments", () => {
  it("--help prints usage on stdout and exits 0 before the registry is read", () => {
    for (const flag of ["--help", "-h"]) {
      const r = run(flag);
      expect(r.status, flag).toBe(0);
      expect(r.stdout, flag).toContain("usage: aidep <local-dir | owner/repo>");
      expect(r.stdout, flag).toContain("Nothing leaves your machine");
    }
  });

  it("a missing path says so instead of asking for a GitHub token", () => {
    for (const path of ["./nope", "../nope", "/nope/either", "nope/"]) {
      const r = run(path);
      expect(r.status, path).toBe(1);
      expect(r.stderr, path).toContain(`no such directory: ${path}`);
      expect(r.stderr, path).not.toContain("GITHUB_TOKEN");
    }
  });

  it("a bare word that is neither a directory nor a slug says which two things it is not", () => {
    const r = run("nope");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('"nope" is neither an existing directory nor an owner/repo slug.');
  });

  it("an owner/repo slug still reaches the token check", () => {
    const r = run("acme/bot");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("GITHUB_TOKEN is not set");
  });

  it("--version prints the CLI package's version from the source tree and from the built dist", () => {
    const expected = JSON.parse(readFileSync(fileURLToPath(new URL("../cli/package.json", import.meta.url)), "utf8")).version;
    expect(expected).toMatch(/^\d+\.\d+\.\d+$/);
    for (const flag of ["--version", "-v"]) {
      const r = run(flag);
      expect(r.status, flag).toBe(0);
      expect(r.stdout.trim(), flag).toBe(expected);
    }
    const dist = fileURLToPath(new URL("../cli/dist/cli/scan.js", import.meta.url));
    if (existsSync(dist)) {
      const r = spawnSync(process.execPath, [dist, "--version"], { encoding: "utf8" });
      expect(r.stdout.trim(), "dist").toBe(expected);
    }
  });

  it("no argument prints usage on stderr and exits 1", () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage: aidep");
  });
});
