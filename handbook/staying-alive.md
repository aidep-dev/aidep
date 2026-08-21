---
title: Staying alive
order: 5
---

# Staying alive

What it costs to run aidep, published, because a tool you are trusting with repo
access should not be one bad month from disappearing without warning.

## The bill

```
Vercel Pro                  $20 / month     shared across four products
Postgres (Neon)             $19 / month     shared
aidep.dev                  ~$15 / year
Cloudflare email routing     $0
GitHub organization          $0
```

Variable cost, and it is the only one that moves with usage:

```
Anthropic extraction   $0.04 to $0.36 per migration PR, and only when
                       a repo opts into evals with `evals: true`
```

Your own eval spend, on your keys, is roughly $0.20 to $2.00 plus four to eight CI
minutes per migration PR. We never see it and never touch those keys.

## What that adds up to

The hosting is shared with three other products, so the marginal cost of aidep
existing is roughly **$2 to $6 a month**. Standing entirely on its own it would be
about **$483 a year**.

That number is deliberately unimpressive, and it is the most important thing on
this page.

## Infra is a rounding error. The cost is a person

A deprecation watch is cheap to serve. Static pages, a small Postgres, a daily job
that fetches three vendor pages. Nothing here scales badly.

What is expensive is the work that makes the output trustworthy: reading provider
pages carefully enough to catch that a replacement is itself already dying, writing
transforms that would rather under-transform than corrupt your code, and chasing
the scanner defects that only show up against real repositories.

So the price is not set to cover servers. One subscription covers the servers
several times over, which sounds good and means almost nothing. The price is set to
cover the person doing that work, which is the only thing that would actually stop
if the money stopped.

This is also why the paid line is a flat monthly fee rather than metered usage.
See [how we make money](/handbook/how-we-make-money).

## Default alive

aidep is not venture funded and is not trying to be. There is no round to work
backwards from and no runway to burn, which means the only question that matters is
whether the paid line covers the person.

Until it does, aidep is a side project that is honest about being one. The free
tier is not at risk either way: the marginal cost of a free repo is cents, and the
registry is CC0 and public, so even in the worst case the ground truth outlives us.

## What would make us change this

If free usage ever cost meaningfully more than the paid line brings in, the answer
is to make the free tier cheaper to serve, not to start charging for it. Scanning,
alerts, and migration PRs stay free. That is a commitment, and if it is ever
broken, this page will say so and explain why rather than quietly changing.
