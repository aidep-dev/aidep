<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# aidep

## Commands

- `npm test` is vitest, not jest. Single suite: `npx vitest run test/transforms.test.ts`.
- `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`eslint`).
- Tests need the docker Postgres: `docker compose up -d` (port 5433), then `node src/db/migrate.ts`.
- `vitest.config.ts` sets `fileParallelism: false` deliberately: suites share that one database and `drain()` claims from the global jobs table, so a parallel file runs another file's job. Do not re-enable it.
- `next dev` / `next build` must carry `--webpack`. Never `--turbo` or `--turbopack`: Turbopack leaks MAP_JIT memory and has kernel-panicked this machine. The `dev` and `build` scripts already carry the flag; keep it.

## Trust boundary

- We never hold a customer model key. Eval runs happen in the customer's CI with the customer's keys.
- One exception: our own Anthropic key, used only for eval-case extraction, only when the repo sets `evals: true` in `.github/aidep.json`. That egress is disclosed on `/security` and in the onboarding PR body. Changing the egress means changing both.
- Repo tarballs are fetched, scanned in memory, discarded.
- Persist findings only: path, line, matched identifier, registry row id. Never source text. Nothing new in `findings` may carry code.

## GitHub App permissions

- Exactly three: metadata read, contents read and write, pull requests read and write.
- Adding a fourth is a product decision, not an implementation detail: the three-permission claim is on `/security` and on the landing page.
- Consequence: we can never write `.github/workflows`. The eval workflow ships at `evals/workflows/aidep-eval.yml` and the PR body carries the move-it step. Findings under `.github/workflows/` are report-only and filtered out before any transform runs.

## Never emit hosted prompt references

- No `prompt={"id":...}` and no `prompt_id` in generated code, generated configs, checklist text, or PR bodies. OpenAI's own migration guide recommends it; `/v1/prompts` dies 2026-11-30 and prompt creation is dashboard-only. Configs are inlined instead.
- `test/transforms.test.ts` and `test/evalgen.test.ts` assert this. Do not weaken those assertions.

## PR policy

- One onboarding PR on install. Nothing else until it merges (`onboarded_at` stays null and every other trigger returns early).
- Migration PRs are opt-in per finding, always, from the dashboard. Never open one on our own initiative. Unrequested PRs are how bots in this category die.

## Pricing shape

- Everything is free on every repo, migration PRs included.
- The eval pack is the only paid line (aidep Proof, $99/org/mo), gated inside `evalPackFor` in `src/pipeline.ts` and nowhere else. Never gate at the API boundary and never gate the PR: an unpaid install still gets the full migration PR, with the one-line skip reason where the eval block would be.

## Transforms

- Corrupting customer code is far worse than under-transforming. An unrecognized shape gets a checklist item, never a guess.
