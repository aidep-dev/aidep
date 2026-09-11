# aidep GitHub App verification map

The maintained source for verifying what the App does on a real repo. Read this index, then the feature file, then drive. `verify-aidep-github-app` in the headings means: `gh` and `canary.sh` for GitHub, the Neon MCP (project `tiny-star-08411946`) for rows, and the owner's own browser for the dashboard and mail.

## Baseline preconditions

- `canary.sh doctor` is all PASS; `canary.sh run` has started a run and `$ART` is `$(bash .claude/skills/verify-aidep-github-app/canary.sh art)`.
- The canary is `ricardodreyes/aidep-canary`. No recipe touches another repo.
- Every probe file is `verify/probe.py` on main, one call, and leaves with `canary.sh probe-remove`.
- All commands run from the aidep repo root.

## Driving conventions

- One push at a time: wait for the refresh readout before the next commit, or the push is dropped behind the running scan.
- Row checks name the sha they look for; a run without the Neon MCP reports them as skipped, never as passed.
- Steps marked owner-driven (a dashboard button, a mail link, a fresh install) are pressed by the account owner; report them as skipped when nobody pressed them.
- Assert on rows and lines being present or absent. Counts and dates move with the registry.
- Never delete artifacts.

## Proof and skip reporting

- Pair the trigger with its effect: the commit sha with the scan row that carries it, the ticked box with the re-rendered section, the button with the PR.
- Save every readout under `$ART` as `<feature>-<step>.<ext>` and name the entry point that produced it.
- Report an unreachable path with the command tried and the unmet precondition. A path nobody drove is not verified through a different one.

## The weekly run

`.github/workflows/canary.yml` runs Doctor and the rescan recipe every Monday with a fine-grained PAT (`CANARY_TOKEN`) and opens or bumps an issue labelled `canary` when it goes red. Evidence lands in the run's artifact. A red issue is the cue to run this skill by hand with the database; the map itself changes only when someone drives it.

## Feature entry contract

Each feature file has an H1, one paragraph on the user-visible behavior, then exactly four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-aidep-github-app`, `Gotchas`. The driving section starts with `Preconditions:` and pairs each user action with the exact command and the observable result. A file whose driving section opens with "Not driven yet" was written from source; its first run replaces that line with the date and evidence.

## Features

- [Install and onboarding](./onboarding.md): the install screen, the Configure aidep PR, what a repo can do before and after the merge, the refresh box.
- [Rescan on push](./rescan.md): a probe commit becomes a finding and its removal resolves it, read back through the refresh box and the scan rows.
- [Migration PRs](./migration-pr.md): the dashboard button, the branch and body a PR gets, the files it may touch, and what merging or closing it does to the findings.
- [Notify mail](./notify.md): the config re-read, confirmation, digest, reminder, and stop.

Not mapped yet: uninstall and reinstall (purges the canary's rows; owner-driven), suspend and unsuspend, the eval pack with a paid installation and the results ingest, the weekly schedule, the registry-change rescan, and the rerun box on migration PRs.

## Open app bugs this map knows about

Output one of these explains is the app, not drift in the map. Each carries the check that says it is still open; when the check passes, delete the entry.

1. **aidep flags its own helper.** After an Assistants migration merges, the next scan reports `aidep/fetch-and-inline.mjs` under assistants-api (its `/v1/assistants` calls and the `OpenAI-Beta: assistants` header) and under v1-prompts (a comment naming `/v1/prompts`). On the canary that is 4 "calls fail today" findings aidep created itself. Open while `canary.sh found` lists `aidep/fetch-and-inline.mjs`.
2. **A merged migration PR leaves the sites it did not fix as `pr_open`.** The Assistants PR left `app/assistant.py:6` (`client.beta.assistants.create`) for its checklist. After the merge the finding is still `pr_open` on that PR, so the repo page shows "PR #2 open · eval: none" for a merged PR and `prCap` counts the merged branch. Open while `select status from findings where repo_id = 1363139886 and path = 'app/assistant.py' and line = 6` says `pr_open`. The fix belongs in the pull_request.closed handler: findings still `pr_open` on a merged PR go back to `open`.
3. **Stale Assistants copy.** The migration PR's title is "Migrate 1 OpenAI Assistants API calls before the Aug 26 shutdown" and its body says the API "shuts down 2026-08-26"; both were written before that date. `test/migration.test.ts` locks the title in. Open while `gh pr view 2 --repo ricardodreyes/aidep-canary --json title` still reads that way.
4. **The repo page offers "Create migration PR" before onboarding.** The button renders on a repo whose onboarding PR is open; pressing it shows "Merge the onboarding PR first; aidep opens nothing else until then." from the API. Seen by the owner on 2026-09-10. Open until the page hides the button while `onboarded_at` is null.
5. **The health probe's mail check only sees the variables.** `probeMail` in `app/api/check/route.ts` is `mailConfigured()`, so `MAIL_FROM` on a parked domain Resend never verified passed every daily run until 2026-09-10. Open while the probe never asks Resend about the sender domain.

Open question, not a bug: a model swap keeps the call's sampling arguments (the canary's `temperature=0.3` survived gpt-4-turbo to gpt-5.6-sol), and the registry has no rows about what the replacement accepts.
