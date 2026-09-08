# Security review, 2026-08-21

Scope: the eight commits from `4130158` to `4f3941b` (registry endpoint, llms.txt, share card,
agent brief, upgrade email, decisions and handbook pages, health workflow, push channel,
funnel), plus the surfaces they lean on: session and OAuth, the cron bearer, the interest
endpoint, the webhook route. Read, not fuzzed. Everything found is listed; severity is a
judgement, not a filter.

## Findings

### 1. Medium: `notify` addresses receive mail without ever agreeing to

`src/notify.ts`, `src/config.ts`. Any address written into `.github/aidep.json` on an installed
repo gets a digest once the repo is onboarded. The person who wrote the file is not the person
who receives the mail. Exploit: install the App on a throwaway repo with
`notify: ["victim@example.com"]`, commit files whose paths carry a message
(`send-bitcoin-to-evil.example/x.py` pinning `gpt-4-32k`), merge the onboarding PR; the victim
receives a plain-text mail from aidep's domain listing those paths and a dashboard link. Bounded
(one mail per event per repo, five addresses, new repos needed for volume) and the content is
plain text with our copy around it, but it is unsolicited mail from our sender to an address that
never opted in, which is both an abuse vector and a deliverability risk for every real customer.

Fix, applied in the commit after this review: an address gets exactly one confirmation mail
carrying an HMAC link; digests go only to confirmed addresses. The ledger dedupes the
confirmation itself, so the worst case is one short mail per address ever.

### 2. Medium: waitlist addresses are subscribed by anyone who POSTs them

`app/api/interest/route.ts` (pre-existing) plus `src/notify.ts` (new consequence). The endpoint
accepts any email with `source: "landing-waitlist"`; the push channel now mails those addresses
once per retirement date inside 14 days. Before this diff the row was inert. Same fix as 1: the
same confirmation step in front of the same mail.

### 3. Low: repo-derived paths land in outbound mail unescaped

`src/notify.ts`. Plain-text mail, so there is no markup to break, and paths are one line each
under our own sentence. Listed because it is the one place repo-derived strings leave the product
by a channel other than a GitHub PR body, where `mdEscape` guards them. With confirmation in
front of delivery (finding 1), a path can only reach someone who asked for mail about that repo.

### 4. Low: the health workflow prints the probe body to a public Actions log

`.github/workflows/health.yml`. The repo is public, so the `jq .` output is public: whether each
key is alive, the probe's one-word model reply, and a code-search count. No secret and no PII,
but an outside reader learns when a key is dead. Acceptable; noted so nobody adds more detail to
`/api/check` without remembering where it ends up.

### 5. Low: sessions cannot be revoked server-side

`src/auth/session.ts` (pre-existing). The sealed cookie carries the GitHub user token and is valid
until the cookie's seven-day `Max-Age` or a `SESSION_SECRET` rotation; there is no server-side
session list. A stolen cookie value works for up to seven days. Authorization is re-answered by
GitHub on every request, so revoking the App authorization on GitHub ends the damage. Acceptable
for now; a `issued_at` inside the sealed payload and a short absolute lifetime would tighten it.

### 6. Low: `/api/interest` accepts unlimited rows

Pre-existing. One row per (source, email) per hour is the only brake; an unauthenticated caller
can fill the table with distinct addresses. Rate limiting is explicitly out of the usual review
scope, and the table is never rendered anywhere, but it feeds the funnel counts in `/api/funnel`,
which will read high if someone bothers.

## Reviewed, no finding

- `/api/registry`: public CC0 data, CORS open by design, one-hour cache.
- `/llms.txt`, `robots`, `sitemap`, `opengraph-image`: static or env-driven; the share card
  fetches a font from Google at render with a silent fallback and takes no input.
- `/api/funnel`, `/api/check`: behind the `CRON_SECRET` bearer with a constant-time compare;
  return aggregates only; 401 when the secret is unset.
- Agent brief in the migration PR body: every repo-derived fragment goes through `mdEscape`;
  the banned `prompt_id` and `prompt={"id"` strings are asserted absent by tests.
- `merged_at` handler branch: touches only a row already matched by `(repo_id, number)`.
- OAuth: random `state` in an HttpOnly cookie checked on callback; token exchange server-side;
  session sealed with AES-256-GCM under a SHA-256 of `SESSION_SECRET`; tampering fails closed.
- `/api/repos/[repoId]/migrate`: session required, `repoId` validated as a positive integer,
  repo access re-checked against GitHub on each call; `SameSite=Lax` means a cross-site POST
  carries no cookie.
- Webhook: signature verified before any handler runs; handler failure is a 500, logged with
  the delivery id (GitHub does not redeliver on its own; redelivery is by hand from the App's
  delivery log); bad signature is a 401.
- SQL: every query is a `postgres` tagged template; no string concatenation anywhere in the diff.
- Recount workflow: `contents: write` scoped to its own repo, runs committed code only, the
  search token stays in a secret.
- Dependency added: `resend` 6.21.0, MIT, lock regenerated on Linux.

## What to do next time

Run this again before Oct 23 against whatever lands between now and then, with the same
"everything found" rule. The two mediums here were design gaps, not coding slips: the moment
a new outbound channel exists, the question is who consented to be on the other end of it.
