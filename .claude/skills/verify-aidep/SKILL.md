---
name: verify-aidep
description: Drive aidep the way a user does and capture proof. Covers the Next.js site (the id lookup, the /dead register, the waitlist and upgrade forms, the auth-gated dashboard), the JSON registry API that agents read, and the aidep CLI scanner. Use when a change under app/, src/, or cli/ needs to be seen working in the real app, before a deploy, or when anyone asks whether a page, an endpoint, or the scan still works.
---

# verify-aidep

aidep has three user surfaces: the site (marketing pages, the `/dead` register with the id lookup, the auth-gated `/dashboard`), the registry JSON API that other people's agents read, and the `aidep` CLI scanner. The GitHub App path (install, onboarding PR, migration PR, cron drain) is exercised by `npm test` against a fake GitHub, not by this skill; it needs a real installation.

Read `features/README.md`, then the feature file for what you are proving, before driving anything. The map is the maintained source: a proof that drives one convenient entry point is incomplete when the map lists others.

## The instance you may drive

Port 3000 is Ricardo's own dev server (`npm run dev`, cwd this repo). Do not navigate to it for a proof, do not send it forms, do not kill it. Verification runs its own production build on another port (default 3100), so nothing you do disturbs the dev session and the process you stop at the end is the one you started.

Shared regardless: the docker Postgres on :5433 (container `aidep-db-1`) and the sibling registry checkout `../aidep-registry/registry`. Rows you insert (waitlist, upgrade) are visible to the dev server and to `npm test`. Every address you type is `verify-<run-id>@example.com`, and cleanup deletes exactly those.

## Launch

From the repo root:

    bash .claude/skills/verify-aidep/verify.sh up

That runs `npm run build` (the script already carries `--webpack`; the Turbopack path is blocked by a hook and has kernel-panicked this Mac), starts `next start -p 3100` in the background with its log inside the run's artifacts dir, and waits until `http://localhost:3100/api/registry` answers with rows. It refuses to start when the port is owned, Postgres is down, or the registry checkout is missing. Ready looks like:

    up: http://localhost:3100  build <id> from <sha>  registry rows: 199
    artifacts: /Users/ricardopc/aidep/.claude/skills/verify-aidep/artifacts/<run-id>

`up --no-build` reuses the last build when nothing under `app/` or `src/` changed since it. Another port: `AIDEP_VERIFY_PORT=3200 bash .claude/skills/verify-aidep/verify.sh up`, and the same variable on every later subcommand.

Build takes 10 to 60 seconds (webpack cache) and prerenders `/`, `/dead`, `/pricing`, which read the registry and the database; a build failure prints the tail of `build.log`.

## Doctor

    bash .claude/skills/verify-aidep/verify.sh doctor

Read-only. One PASS or FAIL line each for: our pid alive; the port's listener is that pid or its `next-server` child; `/api/registry` answers with rows; `/dead` renders 200 (it needs the database); `.next/BUILD_ID` still matches what this instance started from (a rebuild underneath means you are looking at stale code: `down`, then `up`); Postgres ready. Non-zero exit on any FAIL. Run it first whenever anything looks off, and before trusting a screenshot.

## Drive

Browser: the Playwright MCP (`mcp__playwright__browser_*`), which is what this repo has been driven with so far (`.playwright-mcp/` holds the debris). It launches its own Chrome profile: signed in to nothing, empty localStorage, theme "system". `browser_navigate` to a URL, `browser_snapshot` to get element refs, then `browser_click`, `browser_type`, `browser_fill_form`, `browser_press_key` against those refs. Take a fresh snapshot after every navigation; refs do not survive one.

API: `curl` against `http://localhost:3100`. CLI: `npm run scan --silent -- <dir>` from the repo root, no server involved. Database: `verify.sh sql "<query>"`.

Stable handles in this app:

| where | handle |
| --- | --- |
| lookup, on `/` and `/dead#check` | combobox "Model id, endpoint or param"; listbox "Closest registry rows" of role option rows; button "Check"; the chain is a list whose first item starts "you" and whose hops start "then" (a screen-reader word, the eye sees an arrow), ending "alive as far as we know", "no replacement announced", or "the chain loops back on itself"; the miss reads "is not in the registry" with a "File a row" link |
| register, `/dead` | comboboxes "Provider", "Status", "Sort"; textbox "Filter by id"; the count line "N of M rows"; the empty cell "no rows match" |
| waitlist, `/#waitlist` | textbox "Email"; button "Join the waitlist"; done text "You're on the list." |
| upgrade, `/pricing` | textbox "Email"; button "Upgrade"; done text "Thanks. We reply by hand, usually the same day." |
| header and footer | links "register", "security", "handbook", "roadmap", "pricing", "dashboard"; "install" goes to `/#waitlist` while `NEXT_PUBLIC_GITHUB_APP_SLUG` is unset locally; the theme button's name starts "Theme:" |
| dashboard | heading "Repositories" or "Nothing to watch yet"; button "Create migration PR"; button "Sign out" |

Keyboard on the lookup: `/` anywhere outside a field focuses it; ArrowDown and ArrowUp walk the list; Enter with a highlighted option picks it, Enter without one submits what you typed; Escape closes the list.

## Evidence

Every run gets `.claude/skills/verify-aidep/artifacts/<run-id>/` (gitignored). `verify.sh art` prints the absolute path; `up` writes `run.env` (pid, port, build id, git sha, start time) there, and the instance writes `build.log` and `server.log` beside it. Name files `<feature>-<step>.<ext>`.

- Screenshots: `browser_take_screenshot` with `filename` set to the absolute path inside the artifacts dir. Accessibility snapshots: `browser_snapshot` with `filename` likewise; it saves the tree as markdown (no URL header; the tool response carries the URL), which is the assertable form. Pass `target` with a CSS selector such as `#check` to keep the tree to the section under test; the full `/dead` page is thousands of lines. The MCP writes only under the session's working directory (this repo, or a parent such as `~/Documents`, both qualify); a bare relative filename lands in `.playwright-mcp/`, not in the run.
- API bodies: `curl -s ... > "$ART/<name>.json"`; status and headers with `-sD -` or `-w '%{http_code}'`.
- CLI: redirect stdout to a file in the run and echo `$?` beside it.
- Side effects: `verify.sh sql` output, and the `server.log` lines that show what the server did.

Proof standards. Drive the real path (the box, the form, the command), never `sql` inserts or handler imports. Capture the action and the state it produced, not only the final screen: the typed id and the chain, the submitted form and the row. Check side effects where the feature has them (the `interest` row, the absence of a second row within the hour, the log). Numbers drift: the registry had 199 rows on 2026-08-28 and grows, and every date chip moves daily, so compute the expected count from `/api/registry` in the same run instead of asserting a literal. No mocks exist on these paths and none are needed. The one external call reachable from here, `/api/check`, spends Anthropic tokens and a GitHub search request with the real keys, so it is opt-in and marked as such in `features/registry-api.md`.

## Cleanup

    bash .claude/skills/verify-aidep/verify.sh down
    bash .claude/skills/verify-aidep/verify.sh sql "delete from interest where email like 'verify-%@example.com'"

`down` stops the pid recorded for the port and its `next-server` child (by parent pid, never by name), waits for exit, and removes the run record. Artifacts stay. The `sql` line removes the rows this skill's recipes write; it matches nothing else. Close the browser page with `browser_close`. Run `down` after a failed attempt too, so a broken run does not strand port 3100.

## Helpers

`verify.sh` (executable) is the whole harness: `up [--no-build]`, `doctor`, `art`, `sql "<query>"`, `down`. Run it from the repo root; it finds the repo from its own location either way.

Gotchas for the agent:

- A PreToolUse hook blocks any Bash command whose text contains `next dev` or `next build` without `--webpack`. Use the npm scripts and `verify.sh`; do not quote those two phrases in a command.
- `next start` runs with `NODE_ENV=production`, so cookies carry `Secure`. Chrome and Playwright's Chromium accept that on `http://localhost`; curl shows it in `set-cookie`.
- The dashboard cannot sign in on this instance: GitHub returns the OAuth code to `APP_URL` (`http://localhost:3000`), the dev server. `features/dashboard.md` says what is provable and what needs Ricardo.
- `.next/dev` belongs to the dev server; `npm run build` writes `.next/` next to it and the two coexist. Do not delete `.next`.
- `Scan date` in CLI output and `alive` in the API are computed in UTC, so after 5pm Pacific they read as tomorrow.
- Every page logs one console error outside Vercel: `/_vercel/insights/script.js` 404 from `@vercel/analytics`. Expected locally; do not count it as a page error.
- The GitHub App credentials, `CRON_SECRET`, and `SESSION_SECRET` are empty in `.env.local` as of 2026-09-06. The site, the register, the forms, the CLI, and the public API do not need them; `/api/auth/login` answers 500 and the bearer routes answer 401 until they are set, and the recipes say so where it matters.
