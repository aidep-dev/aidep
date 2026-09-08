# aidep verification map

The maintained source for verifying aidep's user-facing behavior. Read this index, then the feature file, then drive. `verify-aidep` in the headings means: the Playwright MCP (`mcp__playwright__browser_*`) for the browser, `curl` for the API, `npm run scan` for the CLI, and `bash .claude/skills/verify-aidep/verify.sh` for the instance and the database.

## Baseline preconditions

- `verify.sh up` has run and `verify.sh doctor` is all PASS. `$URL` is what `up` printed: `http://localhost:3100` unless `AIDEP_VERIFY_PORT` changed it.
- `$ART` is `$(bash .claude/skills/verify-aidep/verify.sh art)`, the absolute artifacts dir for this run, and `$RUN` is its basename.
- Never drive `http://localhost:3000`; that is Ricardo's dev server.
- The browser is the Playwright MCP's own profile: signed in to nothing, theme "system", no stored state.
- Every address you type is `verify-$RUN@example.com` or `verify-$RUN-<step>@example.com`; cleanup deletes the `interest`, `confirmed_addresses`, and `suppressed_addresses` rows matching `verify-%@example.com`.
- All commands run from the repo root.

## Driving conventions

- Start each recipe from a fresh `browser_navigate`; the lookup and the register keep state in the page.
- Use accessible names (role plus name) from a fresh `browser_snapshot`; refs expire on navigation.
- Commands are literal. Keep quoted names, ids, and flags unchanged.
- Registry numbers move (199 rows on 2026-08-28; dates tick daily). Where a recipe needs a count it gives the one-liner that computes the expected value from `$URL/api/registry` in the same run.
- Restore what you changed (delete your rows). Never delete artifacts.

## Proof and skip reporting

- Pair the action with the result: the typed id and the chain, the submitted form and the database row, the command and its exit code.
- UI proof is a screenshot plus an accessibility snapshot saved into `$ART`. A saved snapshot has no URL header, so the report names the URL from the tool response; `run.env` holds the base URL and build.
- API proof is the body and the status code. CLI proof is stdout, stderr, and `$?`.
- Mutation proof includes a read-only second look: `verify.sh sql` for rows, `server.log` for what the server did.
- Name every artifact `<feature>-<step>.<ext>` and say which entry point produced it.
- Report an unreachable path with the command tried and the unmet precondition. Do not report a skipped entry point as verified through a different one.

## Feature entry contract

Each feature file has an H1, one paragraph on the user-visible behavior, then exactly four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-aidep`, `Gotchas`. The driving section starts with `Preconditions:` and pairs each user action with the exact command and the observable result. User paths, stable handles, required state, commands, proof; no implementation detail.

## Features

- [Look up an id](./lookup.md): the hero box and `/dead#check`, examples on focus, the `/` shortcut, suggestions, the chain, the miss state, the API cross-check.
- [The register](./register.md): `/dead` filters, sort, the count line, row anatomy, the rotted-replacements table.
- [Waitlist and upgrade forms](./interest.md): the two `interest` writers, the hourly throttle, the API shape, and what mail does or does not go out.
- [CLI scan](./cli-scan.md): `npm run scan` on the fixtures, exit codes, the published `cli/dist` shape.
- [Registry API](./registry-api.md): `/api/registry`, one-id lookups, the schema, `llms.txt`, the `/replacements` redirect, the funnel, and the opt-in key probe.
- [Dashboard](./dashboard.md): what an unauthenticated visitor gets, the auth-denied banner, and why the signed-in path needs Ricardo's own instance.
- [Confirm and stop links](./mail-links.md): the two links every mail carries, minted locally; the GET pages, the POST that consents to one scope, the one-click stop, and the 400s.

Not mapped yet: the static pages (`/security`, `/handbook`, `/roadmap`), the theme toggle, `/sitemap.xml`, `/robots.txt`, the OpenGraph image, and the whole GitHub App path (webhook, onboarding PR, migration PR, cron drain, the digest and confirmation sends), which `npm test` covers with a fake GitHub.
