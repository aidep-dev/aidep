# Roadmap

Public because it should be. If you want to know what we're doing and why, this is it.
Last updated 2026-08-20.

## The goal

**By 2026-11-30, aidep is default alive: 100 repos watched by people who are not the author, and one org paying.**

That date is not arbitrary. On 2026-11-30 OpenAI's `/v1/prompts` shuts down, and `/v1/prompts` is
what OpenAI's own Assistants migration guide tells you to migrate *to*. The thesis of this project
gets tested on a schedule, in public, on that day.

One paying org is the whole revenue goal, and it is not modesty. Fixed hosting is $20 to $45 a
month. One aidep Proof subscription at $99 covers it several times over. Past that we are default
alive and can keep the rest free forever without it being a favour anyone can withdraw.

100 repos is the number that is actually hard. Today it is 0.

## Where we are, stated plainly

Zero customers. Not deployed. No GitHub App, no host, no billing. `aidep.dev` is registered and
points at nothing. Nothing has ever run outside one laptop.

What does exist: 199 dated and sourced deprecation rows across OpenAI, Anthropic and Google; a
scanner; transforms; migration PR generation; an eval pack; 190 passing tests; and a scan page
with no URL.

Two hand-written issues in August moved two strangers' repos within 48 hours. Nobody has installed
anything and nobody has asked what it costs.

## What we give away and what we sell

**The registry is a public good and it is the point.** 199 rows, every one carrying the vendor URL
it came from and the date it was checked. Anyone can read it, fork it, cite it, or point their own
agent at it. It is CC0. If OpenAI ships it themselves tomorrow, that is a good outcome for
everyone and we still have the watch.

We open source the registry because it is the one thing here a language model cannot derive.
Training cutoffs come before deprecations, by construction. Ask an agent to migrate you off a dead
model and it picks a replacement from what it learned months ago. Of our 174 rows that name a
replacement, **29 name a replacement that is itself already deprecated or retired**. One in six.
`ada` points at `babbage-002`, which dies 2026-09-28. `curie` points at `davinci-002`, same day.
Replacement chains rot, and an agent will say "done" either way.

**The app is open source too**, eval pack included. There is no held-back edition. Self-hosting it
means running your own Postgres, registering your own GitHub App, holding your own Anthropic key
and keeping your own registry current, which is more work than $99 a month. Pretending otherwise
would cost the claim and buy nothing.

**Free, forever, on every repo public or private:** scanning, deprecation alerts, the onboarding
audit PR, and the migration PRs themselves. No cap, no card.

**Paid, one line:** aidep Proof, $99 per org per month, flat. It runs your repo's own prompts
against the old model and the new one, in your CI, on your keys, and reports held-or-drifted per
prompt before you merge. That is the part with real marginal cost and the part that gets the PR
merged.

We never hold a customer model key. Repo tarballs are fetched, scanned in memory, discarded. We
persist findings only: path, line, matched identifier. Never source text.

## What this is, in one sentence

aidep is not a code fixer. It is a watch and a source of ground truth that hands work to the agent
you already have, at the moment it matters, with the facts your model does not have.

Yes, use your AI. We tell you when, and we tell it what is actually true today.

---

## Phase 0: give it a URL

**Now to 2026-08-25.** Gate: a stranger can run aidep without asking permission.

Nothing on this list is a feature. The product is finished and invisible, and that is the entire
problem.

- Create the GitHub organization and move both repos and the App under it. Installers read the
  owner name on the App permission screen, and a product owned by a personal account reads like a
  weekend project.
- Push `aidep-registry` public, CC0 on the data, MIT on the code. This is first because it costs
  nothing and unblocks two other things: `REGISTRY_SOURCE` can finally point at a raw URL, and the
  daily poller workflow starts running instead of sitting dormant in a local repo.
- Push `aidep` public, MIT.
- Ship `npx aidep <dir>`. The local scanner already works against a directory with no token, no
  account and no write access to anything. It is the version of this product that asks for zero
  trust, and it is already written.
- Deploy the app. Vercel Pro at $20, Supabase Free for Postgres, `aidep.dev` pointed at it from
  Cloudflare.
- Register the GitHub App. Three permissions, metadata read, contents read/write, pull requests
  read/write. Tunnel first so the first real webhook delivery lands somewhere debuggable.
- Install it on our own repo and read the onboarding PR before any stranger does.

## Phase 1: be there when it breaks

**2026-08-26 to 2026-08-28.** Gate: three dated numbers held, not published.

The OpenAI Assistants API shuts down on 2026-08-26. On 2026-08-18 there were 16,320 public files
calling `client.beta.threads` and 12,448 calling `client.beta.assistants`.

Recount the same queries on the 26th, 27th and 28th. Save the numbers with the method. Then sit on
them.

Six days is not a sales cycle and the people who were going to migrate already have. What this
week produces is the one piece of evidence nobody who has not built the registry can publish:
proof that the last deadline broke real code, rather than a prediction that the next one will.
That is the October post's opening paragraph, written in August.

## Phase 2: publish the ground truth

**September.** Gate: someone who is not the author cites the registry or files a row against it.

- A JSON endpoint and an `llms.txt` so other people's agents can consume the registry directly.
  Every agent that reads it is a distribution channel we did not have to sell to.
- The demo, not the argument: ask your AI to fix your deprecated model ids, then check whether what
  it picked is also deprecated. One in six says it will not be.
- A short strategy page. Not a 200 page operations handbook, there is one person here.
- Keep sending hand-written issues. One repo at a time, read first, naming a specific file and
  line, never templated, never scripted, disclosed once, never followed up twice. aidep the bot
  never opens an unrequested PR or issue and never will. That is a product invariant, not a
  tactic.

On 2026-09-24 the OpenAI videos API and five Sora rows die. On 2026-09-28, `babbage-002` and
`davinci-002` die, which are the replacements `ada` and `curie` point at. The registry gets to be
right about that in public on the day it happens.

## Phase 3: the launch

**2026-10-23.** Gate: 100 repos watched.

Sixteen registry rows die on 2026-10-23: `gpt-4-turbo`, `gpt-4o-2024-05-13` at 124,416 files,
`gpt-4-0613`, `gpt-3.5-turbo-0125` and the fine-tuned variants. It is the biggest single wave on
the calendar this year and it is far enough out to sell into.

This date replaces the 2026-10-16 Gemini date the plan carried until today. The registry has no
`gemini-2.5-pro` or `gemini-2.5-flash` row dying on 2026-10-16, only preview variants that are
already retired. Launching on a date our own source of truth cannot confirm would be the exact
failure this product exists to prevent.

By then we should have the August recount, whatever the outreach taught us, and at least one
migration PR merged somewhere real, so the post cites a result instead of a promise.

## The calendar does the selling

Every date below is in the registry with the vendor URL it came from.

| Date | What dies | Rows |
|---|---|---|
| 2026-08-26 | Assistants API | 1 |
| 2026-09-24 | Videos API, Sora 2 | 6 |
| 2026-09-28 | `babbage-002`, `davinci-002`, GPT-3.5 variants | 4 |
| 2026-10-02 | `gemini-2.5-flash-image` | 1 |
| 2026-10-23 | `gpt-4-turbo`, `gpt-4o-2024-05-13`, fine-tuned variants | 16 |
| 2026-11-30 | `/v1/prompts`, Agent Builder, Evals | 3 |
| 2026-12-11 | `gpt-5-2025-08-07`, `o3-2025-04-16` | 6 |
| 2027-01-20 | GPT-4o audio and realtime | 9 |

53 more rows die after today. We did not have to invent a reason for anyone to care.

---

## Borrowed from PostHog, and what we are not borrowing

PostHog wrote their handbook before launching, to look mature enough that a stranger would trust
a two week old product. That worked, and it is the position this project is in right now. What
transfers: open source, a free tier that is genuinely free, prices on the pricing page, docs as
the entire marketing function, the website as the sales team, and being weird enough to remember.

What does not transfer, written down so it stops being tempting:

- **No second product.** PostHog's thesis is twelve products sharing one dataset. Going wide before
  the first install is how a one person project dies. This is one narrow watch until 100 repos run
  it.
- **No handbook before there is a company.** A strategy page, yes. Compensation philosophy and
  onboarding process for a headcount of one, no.
- **No price change yet.** $19 has been argued for and it may well be right. Zero people have ever
  been quoted a price, so moving the number now is tuning a variable nobody has touched.
  Positioning decides whether anyone asks. The number waits for the first person who does.
- **No fundraising frame.** Breakeven is one customer. There is no round to work backwards from.
