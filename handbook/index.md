---
title: What aidep is
order: 1
---

# What aidep is

Model providers retire models and APIs on published dates. Your code keeps calling
them until the day it stops working. aidep watches those dates, finds the calls in
your repo, and tells you before the deadline instead of after.

That is the whole product. It is deliberately narrow.

## This handbook

Written so a stranger can decide whether to trust this tool with write access to
their code without having to ask anyone. It covers what we promise, who we build
for, how we make money, and what it costs to keep running.

It is public because a tool that asks for `contents: write` on a private repo owes
you that. If something here turns out to be wrong, it gets corrected rather than
quietly deleted.

## aidep is a watch, not a code fixer

The obvious objection to this product is a good one: you already have a coding
agent, it is free, it runs on your own credentials, and it does not need a stranger
with access to your repo. Fighting that on "we rewrite code better" is a fight
worth losing.

Two things an agent structurally cannot do:

**An agent is pull. Deprecations are push.** You have to know to ask. Nobody wakes
up on the fifteenth of October and thinks to check for retired model ids. That is
the entire reason 308,224 public files still pin a model that died in 2025.

**The model's knowledge is frozen exactly where it needs to be current.** Training
cutoffs come before deprecations, by construction. Ask an agent to migrate you off
a dead model and it picks a replacement from what it learned months ago. Of the 174
rows in our registry that name a replacement, 29 name a replacement that is itself
already deprecated or retired. One in six. `ada` points at `babbage-002`, which
dies on 2026-09-28. `curie` points at `davinci-002`, the same day.

So: yes, use your AI. We tell you when, and we tell it what is actually true today.
Alongside every migration PR we emit an agent brief listing the call sites, the
replacement verified against the registry that day, the traps, and the dates. Hand
it to whatever agent you already use.

## How we work

**One product.** Not a platform, not a suite. One narrow watch until it is good.

**We never open a pull request or an issue you did not ask for.** The onboarding PR
arrives only after you install. Migration PRs are opt-in per finding, from your
dashboard. Nothing automated ever contacts a repo. This is a product invariant, not
a current policy, and it is the reason this category is full of bots nobody trusts.

**Decisions get recorded, not relitigated.** When something is decided, it is
written down with the reasoning and the counter-argument in
[DECISIONS.md](https://github.com/aidep-dev/aidep/blob/master/DECISIONS.md).
Reversing it means a new entry saying why, not a quiet edit.

**Corrections in public.** The registry is the product. If a row is wrong, the fix
is a pull request anyone can read.
