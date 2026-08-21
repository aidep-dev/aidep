# Decisions

Dated, with the reasoning and the counter-argument. Reversing one means a new entry saying why,
not a quiet edit. The handbook's "decisions get recorded, not relitigated" points here.

Backfilled on 2026-08-21 from the commit log; entries before that date carry the commit they
came from.

## 2026-08-17: the eval pack is the only paid line; migration PRs are free everywhere

Migration PRs free on every repo, public or private. Proof (the before/after eval in the
customer's CI) is the paid line. Gate it in `evalPackFor` and nowhere else; never gate the PR.
Counter: gating the PR would convert better. Refused because holding the fix hostage is how bots
in this category die, and Dependabot already priced the PR at zero. (213db4c)

## 2026-08-17: three GitHub permissions, never a fourth

Metadata read, contents read/write, pull requests read/write. Consequence accepted: aidep cannot
write `.github/workflows/`, so the eval workflow ships under `evals/workflows/` with a move-it
step, and workflow findings are report-only. Counter: a checks:write permission would let us put
a status on the default branch. Refused; the three-permission claim is on the landing page and
the security page, and adding one is a public argument, not an implementation detail. (f543836)

## 2026-08-17: never emit hosted prompt references

No `prompt={"id":...}` and no `prompt_id` in anything we generate. OpenAI's own migration guide
recommends them; `/v1/prompts` retires 2026-11-30 and prompt creation is dashboard-only. Configs
are inlined. Tests assert this. (4f710a1, e48a0ac)

## 2026-08-18: match the `.beta.assistants` tail on any receiver

The scanner required the client to be literally `client` or `openai`. ComposioHQ/composio names
it `openai_client` and a live Assistants call was missed. Now the distinctive tail matches and the
receiver is anything. (66882a9)

## 2026-08-19: bare helper names only count with OpenAI context in the same file

`createAndPoll` is a stock Stainless name and `submit_tool_outputs` is a path segment in other
vendors' APIs. Three of nine candidate repos were flagged with no Assistants code at all. Telling a
maintainer their code breaks when it does not is worse than missing them. (4bccd32)

## 2026-08-19: short or dictionary-word ids only match inside quotes

`ada`, `babbage`, `davinci`, `o1` match ordinary prose and identifiers. They now count only inside
a string literal. Object-id literals need an id-shaped run of 16 or more characters; the old floor
of six matched `run_document_ai_processor`. (4bccd32)

## 2026-08-21: $39 per org per month, derived, not $99, picked

$99 was a competitive guess with one sum attached (it covers the servers). $39 comes from a value
model: three retirements a year, eight hours each, $100 an hour, a 10x return bar. Counter: $19 has
been argued and may be right; nobody has been quoted either yet, so the number waits for the first
person who asks. The working is on the pricing page. (3dc5b9d)

## 2026-08-21: prCap defaults to 5 and urgent retirements ignore it

Matches Dependabot's open-pull-requests-limit. Retirements within 30 days bypass the cap the way
Dependabot and Renovate exempt security updates. A blocked request tells the user why instead of
doing nothing. (f14e470)

## 2026-08-21: launch on 2026-10-23, not 2026-10-16

The registry has no `gemini-2.5-pro` or `gemini-2.5-flash` row dying on the 16th, only preview
variants already retired. Sixteen rows die on the 23rd, the largest wave this year. Launching on a
date the registry cannot confirm is the failure the product exists to prevent. (ROADMAP.md)

## 2026-08-21: prose files are never scanned

`.md`, `.mdx`, `.markdown`, `.rst`, `.txt` are skipped. Our own ROADMAP.md and handbook discuss
`ada` and `curie` by name and every mention was reported as "calls fail today". Prose never makes
an API call. (2a53955)

## 2026-08-21: test code is reported, not shouted

Findings under test, fixture, snapshot and mock paths stay in the report but fold under the
production hit, and a retirement seen only in test code is stated without "calls fail today". On
our own onboarding PR 74% of findings sat in test/. The summary line is computed, never typed.
(b7fa1dc)

## 2026-08-21: `npx aidep` ships from `cli/` in this repo, no bundler

A separate package root with its own package.json; tsc emits `cli/dist` with
`rewriteRelativeImportExtensions`. Counter: esbuild would give one file. Refused to add a
dependency for what tsc already does. The registry is read over https when no sibling checkout
exists. (101b2ad)

## 2026-08-21: push goes by email to an address in `.github/aidep.json`

Deprecation alerts after onboarding, and the waitlist mail, go through Resend to addresses the
repo owner writes into `notify` in the config file. Counter: reading the installer's email from
GitHub is one call. Refused because it is a fourth permission. Counter: a dashboard field. Refused
for now because the config file is already the thing they merge; a field can come later.

## 2026-08-21: internal docs live in `docs/`, public ones in `handbook/`

The repo is public, so "internal" means "not rendered on the site". Discovery notes, security
reviews and this file are committed and readable; they are not product copy.

## 2026-08-21: the recount is a committed script and a scheduled workflow

`tools/recount.ts` counts public Assistants API exposure with the same two strings as the 08-18
baseline; `.github/workflows/recount.yml` runs it on Aug 26 to 28 and commits
`evidence/recount/<date>.json`. Git dates the numbers, the method travels with them, and nothing
depends on remembering.
