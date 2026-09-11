# Contributing

aidep is two repos. Deprecation rows (a model or API retiring, its date, its replacement) live in [aidep-registry](https://github.com/aidep-dev/aidep-registry), and a wrong or missing row is filed there with its [issue form](https://github.com/aidep-dev/aidep-registry/issues/new?template=file-a-row.yml). Everything else is this repo: the scanner, the transforms, the GitHub App, the site, the CLI.

## Before a PR

Run it locally first; the README has the setup. A PR needs `npm run typecheck`, `npm run lint` and `npm test` green, and CI runs `npm run build` as well. The suite needs the docker Postgres on port 5433.

Keep a PR to one change you can state in a sentence. Commit messages say what changed and why, in the present tense.

## The rules the code follows

`AGENTS.md` at the root is the contract, and `.claude/rules/` carries the per-directory detail. The short version:

- A transform change needs a fixture pair under `test/fixtures/transforms/<case>/` (`input.<ext>` and `expected.<ext>`), registered in `CASES` in `test/transforms.test.ts`. An unrecognized shape becomes a checklist item in the PR body, never a guess. Corrupting a customer's code is far worse than leaving it alone.
- Nothing aidep emits may point at a hosted prompt (`prompt_id`, `prompt={"id": ...}`). Configs are inlined. Tests assert this; do not weaken them.
- The App holds exactly three permissions (metadata read, contents read and write, pull requests read and write), and the site says so. A fourth is a product decision. aidep never writes `.github/workflows/`.
- One onboarding PR per install, then nothing until it merges. A migration PR opens only when someone asked for it from the dashboard.
- Findings store a path, a line, a matched identifier and a registry row id. Never source text.
- Registry rows are read-only here. A row gets fixed in the registry repo, never patched or hardcoded in this one.

## Where to start

The fixtures under `test/fixtures/` are the fastest way in. A real-world call shape the scanner misses, or one it flags wrongly, is a fixture plus a test. [What the scanner learned](https://aidep.dev/handbook/what-the-scanner-learned) in the handbook says what it already knows.

## Security

A vulnerability goes to the address in [SECURITY.md](SECURITY.md), not to an issue.
