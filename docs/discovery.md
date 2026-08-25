# Customer discovery

Written 2026-08-21, before any conversation with the stated buyer has happened. Nine public
maintainers were qualified by hand in August and all said no to paying; that is where "who we
build for" came from. It is a description of who said no, not of anyone who said yes. This doc
exists so the next five conversations are open-ended instead of a search for confirmation.

## The hypothesis, stated so it can fail

Engineers who own a production integration with a first-party OpenAI, Anthropic or Google API,
on a private repo, at a company where the bot breaking is a support queue, learn about model and
endpoint retirements late (from a failing call, a customer, or a vendor email addressed to someone
else), and spend four to sixteen hours per retirement finding every call site, rewriting it, and
convincing themselves behaviour held.

Every clause is a claim:

- who: the engineer who wrote the integration and owns it by default
- where: private repo, production, a company not a side project
- how often: they intersect two to six retirements a year
- how they find out: late, and not from their own monitoring
- how bad: four to sixteen hours each, plus whatever the outage cost
- what they do today: nothing scheduled; a grep when it breaks

If three of five say "we got the email and fixed it in an hour", the hypothesis is wrong in the
clause that matters.

## What would prove us wrong

Listed first because the tool we would otherwise use to research this will find supporting
evidence on request.

1. **Vendor emails already land.** OpenAI and Anthropic email API key owners before
   retirements. If that mail reaches the engineer in time and names what to change, the watch is
   redundant and the value is only the migration and the proof. Ask who received the last one.
2. **Retirements do not hit them.** Teams that pin the newest model every quarter never intersect
   a retirement. Ask which model ids are in production today and when they were last changed.
3. **The agent already does it.** They ask Claude Code or Cursor "what is deprecated here" at
   some cadence and it is good enough. Ask whether they have ever done that unprompted.
4. **The platform absorbs it.** They go through an API gateway, Bedrock, Vertex or Azure OpenAI,
   whose calendars we do not track and whose abstractions hide the ids. Ask what the URL in the
   client config is.
5. **Nobody pays for proof.** The migration PR is welcome and free; the before/after eval is
   interesting and never bought. Ask what they did last time to convince themselves the swap was
   safe, and whether anyone asked them to.
6. **Wrong person.** The engineer feels the pain and the budget sits with someone who does not.
   Ask who would approve $39 a month and whether they have met.

## Who to talk to, and where they are

Five conversations with people matching the profile. Not maintainers of public repos; public
code search finds them and they have time and no budget line.

Where the profile is reachable without outbound:

- People who opened or commented on deprecation issues in `openai/openai-python`,
  `openai/openai-node`, `anthropics/anthropic-sdk-python` in the last year. They wrote down the
  pain in public once already.
- Forum, Reddit and Stack Overflow threads of the form "gpt-4-0613 deprecated, what do I
  migrate to". Reply with something useful first; ask for twenty minutes second.
- Hacker News on 2026-08-26, the Assistants shutdown day. Whoever posts "this broke us" is the
  profile, live.
- The handful of people who installed the App or joined the waitlist. They already raised a hand.
- Second-degree: anyone in your own network who ships an LLM feature at a company.

No sequences, no templates, no automation. One message per person, naming what they wrote.

## What to ask

Past tense only. "Would you use" produces a polite yes; "tell me about the last time" produces
what actually happened.

1. What calls a model in production today, and which model ids exactly? (Get the literal strings.
   They will not know some of them. That is data.)
2. Tell me about the last time a model or API you used was retired. How did you find out? When,
   relative to the date?
3. What did you do next, step by step? How long did it take, wall clock and engineer hours?
4. How did you decide the replacement was safe? Did anyone ask you to prove it?
5. Who got the vendor email, if anyone?
6. Is there anything scheduled today that would catch the next one? Who owns that?
7. When that integration breaks, who notices first, and what does the next hour look like?
8. Who would sign off $39 a month for a tool in this area, and what would they want to see?

Probe when they deflect on 2, 3 and 6. "We keep on top of it" is a deflection; ask for the last
specific instance.

Do not pitch. If they ask what this is for, one sentence, and go back to questions.

## After every five

Two lists, written before looking at the hypothesis again:

- Evidence that supports it, quoted, with who said it.
- Evidence that challenges it, quoted, with who said it.

If the first list is much longer than the second, the question is whether that asymmetry is in
the interviews or in the interviewer. Re-read the transcripts for the disconfirming items above
specifically.

Then one of three calls, written in `DECISIONS.md` with the date:

- adjust: the profile or the positioning moves, the product does not
- pivot: see below
- back to the idea stage: the problem is not real enough to build around

### Challenge list, running

Quoted as answers arrive, so the list above starts honest:

- 2026-08-22, Simon Willison, `simonw/llm#1617` (docs pinned `gpt-5-2025-08-07`): "Not useful
  in this case, those documents automatically list the models and will be automatically updated
  when they retire." Disconfirmer 3 in its strongest form: the automation exists because he
  built it. Off-profile on every clause (public repo, tooling author, no support queue), so it
  does not move the hypothesis; it does teach the outreach queue to check whether a flagged
  file is generated before sending, and the scanner to skip prose, which it now does.

## The pivot branch, written now

If vendor emails land and engineers migrate in time, the watch is not the product. What survives
is: the registry as ground truth for the agent (the one-in-six rotted replacement figure), the
migration PR with the agent brief, and the before/after proof. Positioning flips from "we tell
you when" to "we tell your agent what is true today and prove the swap held". The install
remains one click and the price stays on proof. The landing page leads with the brief, not the
calendar.

If the platform absorbs it (Bedrock, Vertex, Azure), the registry has to grow a `platform` axis
before the product is sellable to this profile. That is a scope decision, not a build task, and
the trigger is written in DECISIONS.md when it is decided.

## Measurement, defined before launch

The funnel, every step a row we already store:

1. install (`installations`)
2. onboarding PR merged (`repos.onboarded_at`): activation
3. migration PR requested (`prs`)
4. migration PR merged (`prs.merged_at`): value delivered
5. upgrade intent with an email (`interest` where `source = pricing-upgrade`)

Targets for the Oct 23 launch, set now so the number can disappoint:

- Day 7: 40 installs, 20 onboarded. Below 50% activation means the onboarding PR is the problem.
- Day 30: 100 repos onboarded, 10 migration PRs requested, 3 merged, 3 upgrade emails.

False positives to name before the spike: installs that never merge the onboarding PR; stars and
HN points; waitlist emails that never install. None of those count toward 100.
