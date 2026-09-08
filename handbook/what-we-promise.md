---
title: What we promise
order: 2
---

# What we promise

Adjectives are free. Each of these is written so it can actually fail, and so you
can catch us failing it.

## Right, before fast

**An unrecognized code shape gets a checklist item, never a guess.**

Corrupting your code is the one unrecoverable failure this product has. Everything
else is an inconvenience. So when the scanner finds a call it understands and a
transform it has a tested fixture for, it rewrites it. When it finds something it
does not recognize, it writes a line in the checklist and leaves your code alone.

Under-transforming is a worse PR. It is not a worse outcome.

Findings under `.github/workflows/` are report-only and filtered out before any
transform runs, because we cannot write there and would rather say so than fail
half way.

## Reliable

**Every claim carries the vendor page it came from and the date it was checked.**

The registry is not a list we typed once. A job runs daily against the OpenAI,
Anthropic and Google deprecation pages, and when a page changes it opens a pull
request rather than writing to a database. A human merges it. That means every
change to the facts is reviewable, reversible, and has a diff.

Each row carries `source_url` and `verified_at`: the vendor page it came from and
the date that row was last confirmed against it. The poller reads every page daily
but moves `verified_at` only when a row changes, so an old date means the page has
said the same thing since then, not that nobody looked. You can audit any claim we
make without trusting us, which is the point.

A parse returning zero rows for a provider that has rows is treated as a fetch
anomaly, never as a mass removal.

## Fast

Static pages are prerendered and served from the edge. Scans are measured in
seconds against a repo tarball held in memory. Webhook handlers answer inside
GitHub's timeout and queue the real work, because a webhook that times out is a
webhook GitHub stops sending.

If a page needs a spinner, it was built wrong.

## Secure

**Three GitHub permissions, and never a fourth:** metadata read, contents read and
write, pull requests read and write. Comparable tools ask for ten. Adding a fourth
is a product decision that would have to be argued in public, not an implementation
detail, because the three-permission claim is on our security page and our landing
page.

A consequence we accept: we can never write to `.github/workflows/`. The eval
workflow ships as a file in the PR with a one-line move-it step, rather than us
asking for the permission that would let us place it.

**We never hold your model keys.** Eval runs happen in your CI with your keys. One
exception, disclosed on the security page and in the onboarding PR body: our own
Anthropic key is used for eval-case extraction, and only when your repo opts in
with `evals: true`.

**We store findings, never source.** Repo tarballs are fetched, scanned in memory,
and discarded. What persists is a path, a line number, a matched identifier, and a
registry row id. Nothing in our database can reconstruct your code.

**We email only addresses you typed.** The `notify` list in `.github/aidep.json`
gets a plain-text digest when a scan finds a new exposure or a retirement is inside
30 days; the waitlist form gets one mail per retirement date inside 14 days. Both
go through Resend. Before any of that, the address gets one confirmation mail with
a link, per repo that names it (one for the waitlist); nothing else is sent until
it is clicked, because the person who typed an address is not always the person
who owns it, and a click for one repo consents to that repo only. We never read an email
address from GitHub, because that would be a fourth permission. Remove the address
and the mail stops.

**We never emit hosted prompt references.** OpenAI's own migration guide points at
reusable prompt objects. `/v1/prompts` shuts down on 2026-11-30. Following the
official guidance would migrate you into a second migration three months later, so
we inline configs instead, and there are tests that fail if that ever changes.

## Easy

**`npx aidep <dir>` needs no account, no token, and no write access to anything.**
It scans a directory on your machine and prints a report. If that is all you ever
use, that is a success.

Installing the GitHub App is for people who want the watch to keep running without
being asked.

## Premium where it counts

Free is not a demo here. Free gets scanning on every repo public or private with no
cap, deprecation alerts, the onboarding audit PR, and the migration PRs themselves.
No card, no seat limit.

The paid line buys the thing that is genuinely expensive to do well: proof. aidep
Proof runs your repo's own prompts against the old model and the new one, in your
CI, on your keys, and reports held-or-drifted per prompt before you merge. An
unpaid install still gets the complete migration PR, with a one-line skip reason
where the eval block would be. We do not hold the PR hostage.

See [how we make money](/handbook/how-we-make-money).

## When we break these

Every claim on this page is checkable. If you find one that is not true, that is a
bug report and it will be treated as one. The security page carries the technical
detail: [/security](/security).
