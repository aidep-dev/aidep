# Migration PRs

On an onboarded repo's dashboard page, each event with open findings has a "Create migration PR" button. Pressing it opens one PR on a branch named for the event, changing only the files the findings sit in, with a body that lists the changes, a brief for the owner's own agent, and a checklist of what was left by hand. Nothing opens without the press. Merging the PR resolves the sites it fixed on the next scan; closing it unmerged hands its findings back so the event can be requested again.

## Sub-features

- `button` "Create migration PR" turns into "PR queued" and the page refreshes to "PR #N open · eval: none".
- `branch-and-title` the head is `aidep/` plus the registry id with each colon as a hyphen; a model swap is titled "Replace <old> with <new> before <date>".
- `diff` only the finding sites change; a model swap edits one line per site; `.github/workflows/` is never touched; no hosted prompt id appears anywhere.
- `body` "## Changes" with one row per file, "## Agent brief" with the sites, and a "## Manual checklist" when something was left; the rerun box `- [ ] <!-- aidep-rerun -->` at the end.
- `evals-off` with `evals` false the body says nothing about evals; with `evals` true on an unpaid installation it says eval packs are on aidep Proof and the PR ships anyway.
- `merge` merging sets `prs.merged_at`, and the rescan the merge commit triggers resolves the sites the PR fixed.
- `close-unmerged` closing without merging puts the PR's `pr_open` findings back to `open`, and the button comes back.
- `cap` past `prCap` open migration PRs the button answers with the cap sentence; a retirement inside 30 days ignores the cap.

## How to get to it (user POV)

- aidep.dev/dashboard, the repo, then the button under the event's findings table.
- The PR itself on GitHub, from the link the page shows once it is queued.

## Driving it with verify-aidep-github-app

Not driven yet as a whole: the button is the owner's to press. The diff expectation below comes from running the production builder on the probe file locally on 2026-09-10 (`preview-migration.mjs` in that session's scratchpad); the first run that presses the button replaces this paragraph with its date and evidence.

Preconditions:

- Doctor is all PASS; `canary.sh run` has started a run and `$ART` is set.
- The canary's own gpt-4-turbo sites are already migrated, so the probe is the only site the PR can touch.

- **Give the repo a swappable site.** Run `bash .claude/skills/verify-aidep-github-app/canary.sh probe-add gpt-4-turbo | tee "$ART/migration-probe-add.txt"`, then `bash .claude/skills/verify-aidep-github-app/canary.sh refresh > "$ART/migration-found.md"` and `grep -F '| verify/probe.py | 7 | gpt-4-turbo |' "$ART/migration-found.md"`. One line, under `## gpt-4-turbo (openai)`.
- **Press the button (owner-driven).** On aidep.dev/dashboard/ricardodreyes/aidep-canary, under gpt-4-turbo, press "Create migration PR". The button reads "PR queued", and after the refresh the section links "PR #N open · eval: none".
- **The PR.** Run `gh pr list --repo ricardodreyes/aidep-canary --head aidep/openai-model-gpt-4-turbo --json number,title,state | tee "$ART/migration-pr.json"`. One open PR titled "Replace gpt-4-turbo with gpt-5.6-sol before Oct 23, 2026".
- **The diff.** Run `gh pr diff <N> --repo ricardodreyes/aidep-canary | tee "$ART/migration-diff.patch"`. One file, `verify/probe.py`, one changed line: `model="gpt-4-turbo"` to `model="gpt-5.6-sol"` on line 7. `grep -c 'prompt_id\|"prompt":' "$ART/migration-diff.patch"` prints `0`.
- **The body.** Run `gh pr view <N> --repo ricardodreyes/aidep-canary --json body --jq .body | tee "$ART/migration-body.md"`. It opens "This PR replaces gpt-4-turbo (dies 2026-10-23) with gpt-5.6-sol in 1 file.", has "## Changes" with the row `| verify/probe.py | gpt-4-turbo → gpt-5.6-sol | 2026-10-23 |`, "## Agent brief" with `- sites: verify/probe.py:7`, no "eval" anywhere, and ends with the rerun box.
- **Rows.** With the Neon MCP, `select number, branch, eval_status, merged_at from prs where repo_id = 1363139886 and branch = 'aidep/openai-model-gpt-4-turbo' order by id desc limit 1` shows the PR number, `none`, and a null `merged_at`; `select status, pr_id from findings where repo_id = 1363139886 and path = 'verify/probe.py'` says `pr_open` with that PR's id. Save both as `$ART/migration-rows-open.txt`.
- **Close unmerged.** Run `gh pr close <N> --repo ricardodreyes/aidep-canary --delete-branch`. Within seconds the findings query says `open` with a null `pr_id`; save it as `$ART/migration-rows-closed.txt`. The dashboard section shows the button again.
- **Cleanup.** Run `canary.sh probe-remove`, then `canary.sh refresh > "$ART/migration-found-clean.md"` and `grep -c 'verify/probe.py' "$ART/migration-found-clean.md"` prints `0`, then `canary.sh doctor`.

## Gotchas

- Merging the probe's PR instead of closing it leaves `gpt-5.6-sol` on main and the probe-remove step still cleans it up, but the finding resolves through the rescan rather than the close handler, which is a different path than the recipe proves.
- A retiring model with no announced replacement (gpt-4o-transcribe, the rescan probe) gets no PR: the builder returns no files and the job logs "nothing auto-migrated". The button still queues it. Use gpt-4-turbo for this recipe while it lives; after 2026-10-23 pick another swappable model from the registry.
- The canary's Assistants event is stuck on bug 2 in the README, so its button shows "PR #2 open" and cannot be pressed until that finding is released.
- A second press for the same event while its PR is open finds the existing PR (the job answers 422 and refreshes its body) rather than opening another.
