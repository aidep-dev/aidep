# Install and onboarding

Installing the App on a repo opens one pull request, "Configure aidep", that adds `.github/aidep.json` and lists what the first scan found. Nothing else happens on that repo until it merges: no scans on push, no migration PRs. Merging activates aidep with the committed config; closing it unmerged leaves the repo disabled. A checkbox in the PR body re-runs the scan and rewrites the PR.

## Sub-features

- `install-screen` GitHub's install page for aidep-dev shows two permission lines: read access to metadata, and read and write access to code and pull requests.
- `onboarding-pr` within seconds of the install, a PR from `aidep/configure` titled "Configure aidep" adds `.github/aidep.json` with the default config, and its "What we found" matches `npx aidep .` on the same code.
- `before-merge` the repo page reads "main · not onboarded yet" with a link to the onboarding PR, and a migration request answers "Merge the onboarding PR first; aidep opens nothing else until then."
- `merge-activates` merging sets `repos.onboarded_at` and stores the committed config within seconds; the repo page reads "main · daily scans · evals off · PR cap 5".
- `refresh-box` ticking the box rescans main and rewrites the body with the box unticked again.

## How to get to it (user POV)

- aidep.dev, the install button, which opens github.com/apps/aidep-dev/installations/new. Pick the account, then "Only select repositories" and the repo.
- The onboarding PR on that repo, then aidep.dev/dashboard after signing in with GitHub.

## Driving it with verify-aidep-github-app

Preconditions:

- Doctor is all PASS, so the canary is installed and onboarded already.
- `canary.sh run` has started a run and `$ART` is set.
- A fresh install is the account owner's to click at GitHub's install page, and reinstalling means uninstalling first, which purges the canary's rows. Treat that as its own owner-driven run.

- **Onboarding PR.** Run `gh pr list --repo ricardodreyes/aidep-canary --state all --head aidep/configure --json number,title,state,mergedAt`. One PR titled "Configure aidep", state `MERGED`. On 2026-09-10 it was #1, opened 5 seconds after the install.
- **Committed config.** Run `gh api repos/ricardodreyes/aidep-canary/contents/.github/aidep.json --jq .content | base64 -d | tee "$ART/onboarding-config.json"`. JSON with the keys `schedule`, `ignore`, `prCap`, `evals`, and `notify`.
- **Refresh re-renders.** Run `bash .claude/skills/verify-aidep-github-app/canary.sh refresh | tee "$ART/onboarding-found.md"`. It prints "## What we found", a "Scan date:" line with today's UTC date, and a bold summary line. `canary.sh doctor` still reports the refresh box unticked.
- **Rows.** With the Neon MCP, run `select onboarding_pr_number, onboarded_at, config::text as config from repos where owner = 'ricardodreyes' and name = 'aidep-canary'` and save it as `$ART/onboarding-rows.txt`. The PR number from the first step, a timestamp, and the same config as the committed file.
- **Fresh install, owner-driven.** The owner installs with only the canary selected. Within a minute `gh pr list --repo ricardodreyes/aidep-canary --head aidep/configure` shows the new PR, and its "What we found" matches `npm run scan --silent -- <a checkout of the canary>`. Before the merge, a press of "Create migration PR" answers with the refusal sentence above.

## Gotchas

- "All repositories" on the install screen opens a Configure aidep PR on every repo the account owns, empty ones too, because onboarding runs per repo whatever the scan finds.
- The installation webhook carries no default branch, so the repo row says `main` until the first scan reads the real one.
- The refresh box works on the merged PR too, and rewrites it with the pre-merge wording ("Merge this PR to activate aidep"). On the canary that is intended: it is how the map reads a scan without the database.
- The repo page shows "Create migration PR" before onboarding (open bug 4 in the README); assert on the API's refusal.
