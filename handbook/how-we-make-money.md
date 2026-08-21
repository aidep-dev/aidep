---
title: How we make money
order: 4
---

# How we make money

One paid line. Everything else is free and stays free.

## Free, on every repo, forever

Public or private, no cap, no card, no seat limit:

- Scanning, and re-scanning when the registry changes
- Deprecation alerts with dates
- The onboarding audit PR
- The migration PRs themselves
- `npx aidep <dir>`, which needs no account at all

Almost everyone will use aidep and pay nothing, and that is the design rather than
a concession. Free on every repo turns the scan page and the migration PR into
distribution. The question at install time becomes "why not" instead of "is this
worth it".

## Paid: aidep Proof, $39 per org per month, flat

Every repo in the org. No per-seat, no per-repo, no metering.

Proof runs your repo's own prompts against the old model and the new one, in your
CI, on your keys, and reports held-or-drifted per prompt before you merge.

That is the part with real marginal cost and the part that gets a migration PR
merged. Finding a dead model id is a grep, and a good one is still a grep.
Rewriting the call is a transform anyone can review. Neither is worth a
subscription. Knowing the rewrite did not change behaviour is.

## Where $39 came from

The first number we picked was $99, and it was picked rather than derived. It came
from a competitive argument (Dependabot and Renovate are free on private repos, so
the paid line has to be the part they do not do) and the only arithmetic attached
was that one subscription covers the server bill. That prices the servers.

Here is the working, so you can disagree with the inputs instead of the number.

**What a year of deprecations costs you**

```
retirements that hit your code       3 per year
engineer hours to handle each        8
loaded hourly cost                   $100
                                     ------
value                                $2,400 per year
```

Three a year is deliberately conservative. Our own registry counted **6 distinct
retirement dates in 2024, 14 in 2025, and 31 in 2026** across OpenAI, Anthropic and
Google, and the rate is roughly doubling. You intersect a fraction of those, so
three is the low end rather than the average. (2027 currently shows only three
dates, which is an artefact: retirements are typically announced about a year out,
so future years always look empty until they are not.)

Eight hours is the midpoint of a four to sixteen hour range: finding every call
site, rewriting them, and confirming behaviour held. $100 an hour is below the $150
to $250 that senior US rates actually run, so the model understates value rather
than flattering it.

**From value to price**

The usual bar for software is that a customer should get back at least ten times
what they pay, which caps this at $240 a year. The other standard method, taking 10
to 20 percent of value created, gives $240 to $480. $39 a month is $468 a year: the
top of that band for a light user, comfortably inside it for anyone with real
exposure.

$99 would have been $1,188 against $2,400 of value. That is roughly two times
return, not ten. It was above the line and it should not have taken this long to
notice.

**Against the alternatives**

```
Dependabot, Renovate            $0
Mend Renovate Enterprise        $250 per developer per year
CodeRabbit Pro                  $24 to $30 per developer per month
Snyk Team                       $25 to $52 per developer per month
GitHub Code Security            $30 per committer per month
aidep Proof                     $39 per org per month
```

Flat for the whole organisation, so at a team of two we are under a single seat of
anything else on that list.

## Why not charge per pull request

PostHog charges $15 for each pull request their agent opens, with the first three
each month free. It is a good model and it is the obvious thing for us to copy. We
are not copying it, for two reasons.

**The events are too rare.** Their agent produces many pull requests; the default
spending cap is $150 a month. aidep produces two to six migrations a year. At $15
each that is $30 to $90 a year, which does not fund the work.

**It would invert the incentive.** Raising the per-PR price enough to matter means
you pay more the more migrations you do, so the cheapest behaviour becomes not
migrating. For a product whose entire job is getting you off a dying API before a
deadline, that is backwards. PostHog does not have this problem because merging
their PR is the point; ours is preventing an outage you cannot see yet.

## Why flat, and not usage-based

Usage pricing is right when your costs scale with usage. Ours do not. The expensive
input here is the time spent keeping the registry correct and the transforms from
corrupting anyone's code, and that cost is the same whether you have one repo or
forty.

PostHog, whose pricing thinking we borrowed most of, puts it directly: when the
engineering time is the most expensive part, consider a flat monthly fee rather
than metering.

Metering the scan would also make the free tier a countdown, and it would produce a
bill that scales with how broken your codebase is. That punishes exactly the
customer who needs this most.

## What we will not do

**We will not gate the migration PR.** An unpaid install gets the complete PR, with
a one-line skip reason where the eval block would be. Holding the fix hostage to
sell the proof would be the obvious move and it is refused.

**We will not charge per seat.** More people inside a tool is good for us. Charging
for it is a tax on the thing we want.

**We will not charge more for private repos.** Dependabot is free on private repos.
Renovate Community is free on unlimited private repos. That boundary is already
priced at zero by people much larger than us.

**We will not do outbound sales.** No cold email, no automated issues, no bot that
opens a PR to introduce itself. Everything that reaches a repo is asked for first.

## When the price changes

The number gets reviewed once a year against three things: what comparable tools
charge, what it costs us to run, and whether anyone has actually flinched at it.

If it goes up, existing customers get sixty days of notice, and the reason gets
written down here rather than announced in an email nobody reads. If a review
concludes we are overcharging, it goes down and existing customers move to the
lower price automatically.

The current number has not yet survived contact with a single price conversation.
When it does, this page gets updated with what was learned.

## What it costs us to run

See [staying alive](/handbook/staying-alive).
