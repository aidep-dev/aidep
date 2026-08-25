# The launch post. Draft, grows as evidence lands. Venue decided at the Sept 8 review.

Working title: On October 23, sixteen AI models die. Here is what happened the last time.

## Opening: the recount (numbers land Aug 26-28, evidence/recount/)

On 2026-08-18, eight days before OpenAI shut the Assistants API down, GitHub code search found
16,320 public files calling `client.beta.threads` and 12,448 calling `client.beta.assistants`.

On the day it died: [26th count]. The day after: [27th count]. Two days after: [28th count].

[Whichever way the numbers moved is the story. Fell hard: everyone migrated late, under the gun.
Barely moved: thousands of repos now contain calls that fail, and nobody noticed. Both make the
point; write the one that happened. Method is committed next to each number in evidence/recount/,
same two quoted strings, so anyone can rerun it.]

## Why your agent did not save you

Ask your model what replaces a dead id and it answers from its training data, which predates the
deprecation by construction. Of the [N, computed on /replacements] registry rows that name a
vendor replacement, [M] name one that is itself already deprecated. One in six. `ada` pointed at
`babbage-002`, which died 2026-09-28. [Confirm the 09-28 outcome when it happens.]

Try it: paste your replacement into https://aidep.dev/replacements before you trust it.

## What is dying October 23

Sixteen rows, the biggest single wave this year: `gpt-4-turbo`, `gpt-4o-2024-05-13` at
[public file count from /dead], `gpt-4-0613`, `gpt-3.5-turbo-0125`, and the fine-tuned variants.
Table generated from the registry; every date links to the vendor page.

## What aidep is

One paragraph, the roadmap's sentence: not a code fixer, a watch and a source of ground truth
that hands work to the agent you already have, at the moment it matters. Free on every repo;
the eval run that proves a migration held is $39/org/month. [Link the canary or design-partner
migration PR here; one merged PR somewhere real beats every claim above.]

## Evidence checklist before this ships

- [ ] Three recount numbers committed with method (Aug 26-28, automatic)
- [ ] Sept 24 Sora and Sept 28 babbage-002/davinci-002 deaths observed and rows flipped
- [ ] One migration PR merged on a repo that is not ours
- [ ] The one-in-six figure re-computed from the live registry the week of the post
- [ ] Venue decided (Sept 8), account with posting history if HN
