---
title: What the scanner learned
order: 5
---

# What the scanner learned

Every precision fix in the scanner names the real repository that taught it and the date. This
page is that list, in order. It is the part of aidep that nobody can write without having run the
scanner against strangers' code, and the reason a grep is not the same product.

The rule behind every entry: telling someone their code breaks when it does not is worse than
missing them. A false finding costs the one thing an uninvited tool has, which is the reader's
willingness to open the next one.

## 2026-08-18: the client is not always called `client`

The Assistants matcher required the receiver to be literally `client` or `openai`. OpenAI's own
examples use `openai_client`; real code uses `oai`, `_client`, `self.client`. A live Assistants
call in ComposioHQ/composio was missed, found by diffing the scanner's output against a human
migration of the same file. The distinctive `.beta.assistants` and `.beta.threads` tail now
matches on any receiver. That file is a regression fixture.

## 2026-08-19: a helper name alone proves nothing

`createAndPoll` is a stock Stainless codegen name that appears across most generated SDKs, and
`submit_tool_outputs` is a path segment in other vendors' chat APIs. Without a gate, three of
nine candidate repositories (coze-js, mixedbread-ts, anymodel) were flagged as exposed while
containing no OpenAI Assistants code at all. Bare helper names now only count when the same file
shows an unambiguous OpenAI marker.

## 2026-08-19: `thread_channel` is not a thread id

Real OpenAI object ids are a prefix plus about 24 random alphanumerics. The old floor of six
characters after `thread_` or `run_` matched ordinary snake_case names: `run_document_ai_processor`
and `thread_channel` produced twelve false findings in one repository, 43% of that scan. The
literal now needs an id-shaped run of sixteen or more characters and refuses a trailing word
character.

## 2026-08-19: `ada` is an English word

Short or dictionary-word model ids (`ada`, `babbage`, `davinci`, `o1`) match prose and ordinary
identifiers. They now count only inside a string literal. Distinctive ids (a digit, a hyphen, six
or more characters, or a path shape like `/v1/assistants`) still match bare.

## 2026-08-19: Ruby spells it differently

`client.beta(assistants: OpenAI::Assistants::BETA_VERSION)` is a keyword argument, not a dot
chain. Every Assistants call in alexrudall/ruby-openai (45 million downloads) was missed until
the form was added.

## 2026-08-21: prose never makes an API call

Our own ROADMAP.md and handbook discuss `ada` and `curie` by name, and every mention was
reported as "calls fail today" on our own onboarding PR. Markdown, reStructuredText and plain
text are now skipped outright.

## 2026-08-21: test code is real, and it is not the lead

On the same PR, 74% of findings sat under `test/`, in fixtures and snapshots that pin dead
models on purpose, each headed "calls fail today". Those findings stay in the report. They fold
under the production hit for the same retirement, or into one block at the end when a retirement
is seen only in test code, and a test-only retirement is stated without the alarm.

## 2026-08-21: `vendor/**` did not cover `vendor/.env`

`ignore` globs follow shell rules, where `**` skips dotfiles. `test/**` left two fixture
dotfiles open. A glob now ignores the path itself and everything beneath it by prefix.

## How this list grows

Every scanner change that came from a real repository adds an entry here, with the date. A change
with no repository behind it is a guess, and guesses are what the checklist is for.
