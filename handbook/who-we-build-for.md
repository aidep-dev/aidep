---
title: Who we build for
order: 3
---

# Who we build for

## The team

A software team shipping something that calls a model API in production, on a
private repo, with nobody whose job is watching vendor deprecation pages.

Size does not matter much. What matters is the shape:

- Something in production depends on a first-party OpenAI, Anthropic or Google API.
- Nobody has slack to audit for retirements before a deadline.
- A customer notices when the bot stops answering.

That last one is the real qualifier. If your AI feature breaking is an annoyance,
you do not need a watch. If it is a support queue, you do.

## The person

An engineer, usually the one who wrote the integration and now owns it by default.
They are already using a coding agent and are perfectly capable of doing the
migration themselves. What they are short on is warning.

We are not building for a procurement team, a compliance officer, or an AI platform
group. If your company has a person whose actual job is tracking model
deprecations, you have already solved this and we have nothing to sell you.

## Who we are not for, said plainly

**Open source maintainers are not the buyer, and we learned that the hard way.**

Public code search finds maintainers, because public code is overwhelmingly written
by them. Nine repositories were qualified by hand, each read properly, each asked
the same question: would this owner pay for eval-backed migration? Every answer was
no, for different reasons with one root.

A maintainer has time, skill, ownership, and no budget line. A company with a
private production repo has budget and no time. The channel that finds the first
group cannot see the second, which is an uncomfortable fact about our own
distribution and it is written here rather than buried.

This does not mean maintainers do not matter. Two of them changed their code within
48 hours of a hand-written issue naming one file. That is the free tier working
exactly as intended, and it stays free forever.

**Also not for us:** teams whose product is absorbing provider churn. Selling a
deprecation detector to an API gateway is selling coal to Newcastle.

## What this means for the product

Because the buyer is on a private repo, everything is free on private repos. In this
category, public versus private is a line Dependabot and Renovate already priced at
zero, and charging for it would read as a joke to anyone who has configured either.

Because the person is already using an agent, we feed the agent rather than compete
with it.

Because nobody has slack, the install has to be worth it in one click and the first
PR has to be readable in one sitting.
