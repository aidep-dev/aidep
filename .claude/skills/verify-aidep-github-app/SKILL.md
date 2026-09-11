---
name: verify-aidep-github-app
description: Drive aidep's GitHub App in production against the canary repo ricardodreyes/aidep-canary and capture proof. Covers install and onboarding, rescans on push, the onboarding refresh checkbox, migration PRs from the dashboard, and notify mail. Use when a change under src/github/, src/pipeline.ts, src/jobs.ts, src/scanner/, src/transforms/, src/notify.ts, app/api/github/, app/api/repos/, or the dashboard needs to be seen working on a real repo, after a production deploy, or when anyone asks whether install, onboarding, scans, or migration PRs still work.
---

# verify-aidep-github-app

aidep's GitHub App path runs only in production: GitHub delivers webhooks to aidep.dev, jobs drain on Vercel, and rows land in the Neon database. Production is the instance, and the canary repo `ricardodreyes/aidep-canary` is what you drive. It is private, a small support bot on the OpenAI Assistants API and gpt-4-turbo, and the App is installed on it with only that repo selected. The site, the registry API, and the CLI belong to `verify-aidep`.

Read `features/README.md`, then the feature file for what you are proving, before driving anything.

## The instance you may drive

Production aidep.dev and the canary repo, nothing else. Every write lands for real: commits on the canary's main, PR body edits, scan and finding rows. The App's other installation, on the aidep-dev org, covers `aidep-dev/aidep`, the public product repo, where a migration PR is a public PR on the product itself. Leave that repo, and every other repo of the account, alone.

Three layers, three ways in:

- GitHub, through `gh` signed in as an account that can push to the canary. `canary.sh` wraps what the recipes need.
- The database, through the Neon MCP (`mcp__Neon__run_sql`, project `tiny-star-08411946`). Local sessions have it; claude.ai routines do not. A run without it names every row check it skipped.
- The dashboard, through a browser signed in to aidep.dev with GitHub. Playwright's profile is signed out and signing in needs the account's credentials, and the Chrome extension is not allowed on aidep.dev, so dashboard steps are the account owner's to press unless they allow the site. A run without it names every dashboard step it left to them.

## Launch

Nothing to start. Begin a run record from the aidep repo root:

    bash .claude/skills/verify-aidep-github-app/canary.sh run

It prints the absolute artifacts dir for the run; `canary.sh art` prints it again. Ready means Doctor is all PASS.

## Doctor

    bash .claude/skills/verify-aidep-github-app/canary.sh doctor

Read-only. One PASS or FAIL line each: gh reaches GitHub as someone; the App is public, because a private App installs on its own org only; gh can push to the canary; the onboarding PR (head `aidep/configure`) is merged and its refresh box is unticked; `.github/aidep.json` on main parses; no probe file is left on main; aidep.dev/api/registry answers 200; the last `health.yml` run on aidep-dev/aidep succeeded. Non-zero exit on any FAIL. Run it first, and again whenever an answer looks wrong.

## Drive

The readout that needs no database is the onboarding PR's refresh box. Ticking `- [ ] <!-- aidep-rebase -->` sends GitHub's pull_request.edited webhook; aidep rescans main and rewrites the PR body from that scan, box unticked again. `canary.sh refresh` ticks it, waits for a body newer than the tick with the box unticked, and prints the "What we found" section. It works on the merged onboarding PR, which is what makes it repeatable.

| where | handle |
| --- | --- |
| onboarding PR | head `aidep/configure`; title "Configure aidep"; section "## What we found"; refresh marker `- [ ] <!-- aidep-rebase -->` |
| migration PR | head `aidep/` plus the registry id with each colon as a hyphen (`aidep/openai-model-gpt-4-turbo`); sections "## Changes", "## Agent brief", "## Manual checklist"; rerun marker `- [ ] <!-- aidep-rerun -->` |
| dashboard | aidep.dev/dashboard; repo page line "main · daily scans · evals off · PR cap 5" or "main · not onboarded yet"; button "Create migration PR", then "PR queued"; link "PR #N open · eval: none"; refusal "Merge the onboarding PR first; aidep opens nothing else until then." |
| mail | "Confirm your address for aidep"; digest subject `<owner>/<repo>: <event> <when>`; the confirm and stop pages each hold one button |
| rows | `repos` (onboarding_pr_number, onboarded_at, config), `scans` (head_sha, stats), `findings` (path, line, matched, status, pr_id), `prs` (number, branch, merged_at), `jobs` (type, status, last_error), `notifications` |

## Evidence

Everything goes in the run's artifacts dir (gitignored), named `<feature>-<step>.<ext>`: PR body sections as `.md`, `gh` and SQL output as `.txt`. Cleanup leaves them in place.

Proof standards. Drive the real trigger: a commit on main, the checkbox, the dashboard button, a mail link; never a direct SQL insert or a job enqueued by hand. Pair each action with the state it produced: the pushed sha with the scan row carrying it, the ticked box with the re-rendered findings. Check side effects where they exist: the finding's status, `prs.merged_at`, the notifications ledger. Registry dates and counts drift, so assert on an exact row being present or absent rather than on a count from an earlier run.

## Cleanup

    bash .claude/skills/verify-aidep-github-app/canary.sh probe-remove
    bash .claude/skills/verify-aidep-github-app/canary.sh untick
    bash .claude/skills/verify-aidep-github-app/canary.sh doctor

`probe-remove` deletes `verify/probe.py` from main and prints `absent` when there is nothing to delete. `untick` restores the refresh box when a refresh never came back. Close any PR the run opened with `gh pr close <n> --repo ricardodreyes/aidep-canary --delete-branch`. Leave the App installed and the canary's own code as it stands. Doctor all PASS is the clean state.

## Helpers

`canary.sh` (executable) is the whole harness: `run`, `art`, `doctor`, `probe-add [model]`, `probe-remove`, `refresh [seconds]`, `found`, `untick`. Its header says what each does. `AIDEP_CANARY=owner/repo` points it at another canary.

## Gotchas

- A webhook starts the job queue as it answers, so onboarding PRs, migration PRs, and rescans land within seconds. Anything that misses that waits for the 10-minute cron drain, and mail only ever goes out on the cron.
- A push to main that arrives while a scan for the repo is queued or running is dropped, unless it touches `.github/aidep.json`. Let a refresh come back before the next push.
- GitHub asks the account owner to re-authenticate before it shows the App's settings pages; that step is theirs.
- The App has two installations sending webhooks to the same production: the aidep-dev org, for the product repo, and ricardodreyes, for the canary.
- `features/README.md` lists the open app bugs this map knows about, each with the check that says it is still open. Output one of them explains is the bug, not drift in the skill.
- A claude.ai routine's sandbox has no `gh` and its egress proxy refuses github.com and aidep.dev (seen 2026-09-11), so nothing here runs there. The weekly run is `.github/workflows/canary.yml`.
