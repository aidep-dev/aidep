# Rescan on push

After onboarding, every push to the default branch rescans the repo: a new call to a retiring model becomes a finding, and a removed one resolves. The dashboard and the digest mail read those findings. The onboarding PR's refresh box prints the same findings back into the PR, which is how this recipe proves the scan with `gh` alone.

## Sub-features

- `push-scan` a commit to main enqueues a scan within a second, recorded with the pushed sha.
- `finding-appears` a new call to a registry model becomes an open finding at its path and line.
- `finding-resolves` removing the call resolves the finding on the next scan.
- `refresh-readout` the onboarding PR's "What we found" reflects main as it stands.

## How to get to it (user POV)

- Push to the default branch of an onboarded repo. The findings show on aidep.dev/dashboard and, with `notify` set, in the digest mail.
- Scans also run daily or weekly, per `schedule`, and whenever the registry changes.

## Driving it with verify-aidep-github-app

Preconditions:

- Doctor is all PASS, which includes no probe on main and the refresh box unticked.
- `canary.sh run` has started a run and `$ART` is set.

- **Add the probe.** Run `bash .claude/skills/verify-aidep-github-app/canary.sh probe-add | tee "$ART/rescan-probe-add.txt"`. It prints a 40-character commit sha. The commit adds `verify/probe.py` with one `chat.completions.create(model="gpt-4o-transcribe", ...)` call on line 7.
- **Read it back.** Run `bash .claude/skills/verify-aidep-github-app/canary.sh refresh > "$ART/rescan-found-with-probe.md"`, then `grep -F '| verify/probe.py | 7 | gpt-4o-transcribe |' "$ART/rescan-found-with-probe.md"`. One matching line, under a `## gpt-4o-transcribe (openai)` heading.
- **Scan row, added.** With the Neon MCP, run the query below with the sha from the first step and save it as `$ART/rescan-rows-added.txt`. A `done` scan carrying that sha, and `probe_finding` reading `open line 7`.
- **Remove the probe.** Run `bash .claude/skills/verify-aidep-github-app/canary.sh probe-remove | tee "$ART/rescan-probe-remove.txt"`. It prints the removal commit's sha.
- **Read it back again.** Run `bash .claude/skills/verify-aidep-github-app/canary.sh refresh > "$ART/rescan-found-clean.md"`, then `grep -c 'verify/probe.py' "$ART/rescan-found-clean.md"`. It prints `0`.
- **Scan row, removed.** With the Neon MCP, the same query with the removal sha, saved as `$ART/rescan-rows-removed.txt`. A `done` scan carrying that sha, and `probe_finding` reading `resolved line 7`.
- **Proof.** The two found sections, the two shas, and the two row files. A GitHub-only run reports both row checks as skipped.
- **Cleanup.** Run `canary.sh probe-remove`, which prints `absent`, then `canary.sh doctor`, all PASS.

```sql
select left(s.head_sha, 7) as sha, s.status, s.stats::text as stats,
  (select f.status || ' line ' || f.line from findings f
     where f.repo_id = s.repo_id and f.path = 'verify/probe.py') as probe_finding
from scans s
where s.repo_id = (select id from repos where owner = 'ricardodreyes' and name = 'aidep-canary')
  and s.head_sha = '<sha>';
```

## Gotchas

- The probe calls gpt-4o-transcribe (dies 2027-02-26) because the canary's own code never does, so its heading and row belong to the probe alone. After that date the event reads retired and is still a finding.
- gpt-4o-transcribe has no announced replacement, so it cannot open a migration PR; `features/migration-pr.md` uses a different probe model.
- Wait for each refresh to come back before the next push. A push that lands while a scan for the repo is queued or running is dropped, unless it touches `.github/aidep.json`.
- A refresh scans main too, with no sha, so each refresh adds a scan row with `head_sha` null.
- The found section also lists `aidep/fetch-and-inline.mjs` (open bug 1) and `app/assistant.py` line 6, the site the Assistants migration left for its checklist. Neither belongs to the probe.
- The probe commits are authored by whoever `gh` is signed in as.
