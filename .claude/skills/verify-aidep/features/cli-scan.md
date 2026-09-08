# CLI scan

`aidep <dir>` scans a local directory against the registry and prints a markdown report: a summary line, one section per deprecation event with file and line, workflow files called out as manual, and the scanned and skipped counts. It reads the sibling registry checkout when present, sends nothing anywhere, and writes nothing.

## Sub-features

- `scan-report` a directory with exposures prints the report headed `# aidep scan report`.
- `scan-clean` a directory without exposures prints `No exposures found.`
- `scan-usage` no argument exits 1 with the usage line.
- `scan-bad-target` a path that does not exist and is not `owner/repo` exits 1 with a reason.
- `scan-remote-needs-token` `owner/repo` without `GITHUB_TOKEN` exits 1 before any network call.
- `scan-published` `cli/dist/cli/scan.js` (what `npx aidep .` runs) prints the same report as the dev command.

## How to get to it (user POV)

- `npm run scan -- <dir>` in this repo.
- `npx aidep .` in any repo (the published package; `cli/` is its root).
- The "npx aidep ." copy button in the landing hero.

## Driving it with verify-aidep

Preconditions:

- Run from the repo root. No server is needed; `$ART` still comes from a running instance, or use any directory you name in the report.
- `../aidep-registry/registry/openai.json` exists. Without it the CLI reads the published registry over https, which the proof does not want.

- **Report on the fixture.** Run `npm run scan --silent -- test/fixtures/fixture-repo > "$ART/cli-scan.txt"; echo "exit=$?"`. Exit is `0`. The file starts `# aidep scan report`, then `Repo: test/fixtures/fixture-repo`, `Scan date: <today, UTC>`, a bold summary `**N findings in 7 files · D dead · Y dying ...**`, then sections. The first section is `## claude-3-5-sonnet-20241022 (anthropic)` with `**retired 2025-10-28; calls fail today**`, `Replacement: claude-sonnet-4-6`, and the table row `| src/claude_client.py | 8 | claude-3-5-sonnet-20241022 |`. The `gemini-2.0-flash-001` section ends with `.github/workflows/nightly.yml: workflow file; aidep will not edit this path; migrate manually`. The last line is `Files scanned: 8, skipped: 2` (`package-lock.json` as a lockfile, `docs/notes.md` as prose).
- **Clean directory.** Run `npm run scan --silent -- test/fixtures/clean-repo > "$ART/cli-scan-clean.txt"; echo "exit=$?"`. Exit `0`; the file contains `No exposures found.` and `Files scanned: 3, skipped: 0`.
- **Usage.** Run `npm run scan --silent 2>"$ART/cli-scan-usage.txt"; echo "exit=$?"`. Exit `1`; the file is `usage: aidep <local-dir | owner/repo>`.
- **Bad target.** Run `npm run scan --silent -- no-such-dir 2>&1 | tail -1; echo "exit=${PIPESTATUS[0]}"`. Exit `1`; the line is `"no-such-dir" is neither an existing directory nor an owner/repo slug.`
- **Remote without a token.** Run `env -u GITHUB_TOKEN npm run scan --silent -- octocat/Hello-World 2>&1 | tail -1; echo "exit=${PIPESTATUS[0]}"`. Exit `1`; the line is `GITHUB_TOKEN is not set; it is required to fetch octocat/Hello-World from GitHub.` No request was made.
- **Published shape.** Run `npm run build:cli --silent && node cli/dist/cli/scan.js test/fixtures/fixture-repo > "$ART/cli-scan-dist.txt" && diff "$ART/cli-scan.txt" "$ART/cli-scan-dist.txt" && echo same`. Prints `same`.
- **Proof.** The five files in `$ART` plus the exit codes you echoed, quoted in the report.

## Gotchas

- `--silent` matters: without it npm prefixes the report with its own `> aidep@0.1.0 scan` lines.
- `Scan date` is UTC, so after 5pm Pacific it is tomorrow's date, and every `(N days)` count moves with it. Assert structure, not day counts.
- The fixture plants exposures in `.env.example` and in a workflow file on purpose; both appear in the report.
- `test/fixtures/fixture-repo` has no test segment inside it, so nothing folds into the "seen only in test code" block; that rule shows on `test/fixtures/real-world/` if you need it.
- `npm run scan -- owner/repo` with a token fetches a tarball from GitHub: network, and a real token in the environment. Not part of a routine proof.
- `npm run build:cli` overwrites `cli/dist` (gitignored); it is what `npm publish` runs from `cli/`.
- `${PIPESTATUS[0]}` is bash; the Bash tool runs zsh, where the same value is `${pipestatus[1]}`. Run the two error steps under `bash -c '...'` if the exit code comes back empty.
- A target with a slash in it, `./x` included, is read as `owner/repo`, so a missing local path must be given without one to reach the "neither" message.
- A tarball fetch now caps at 256 MB (compressed download and decompressed alike) and a scan reads at most 5000 file entries; either cap trims the report and adds a line saying it is a floor. `test/fixtures/fixture-repo` is nowhere near either cap, so the recipe above never exercises this path.
