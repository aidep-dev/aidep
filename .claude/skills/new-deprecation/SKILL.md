---
name: new-deprecation
description: Get a new deprecation row into the registry. Use when a provider announces a model or API retirement that aidep does not track yet.
---

All of this happens in the aidep-registry repo (sibling checkout, `../aidep-registry`). This app never writes registry rows.

1. Find the announcement on the provider's own page: OpenAI `developers.openai.com/api/docs/deprecations`, Anthropic `platform.claude.com/docs/en/about-claude/model-deprecations`, Google `ai.google.dev/gemini-api/docs/deprecations`. A blog post or a third party is not the source of record; `source_url` must be the provider page the parser reads.

2. Update the fixture in `test/fixtures/` for that provider to include the new page content, so the parser has something to parse and the quirk is captured. Then make the parser handle it if it does not already.

3. The row needs: `source_url`, `announced` and `dies` (with `dies_is_earliest_possible` true when the provider says "not sooner than"), `api_ids` (every string a customer would actually have in their code, because that is what the scanner greps for: the bare model id, the SDK call path, the REST path, the header), `replacement_id` plus `replacement_notes` when the provider names one, `migration_url` when there is a guide, and `status` (`legacy` / `deprecated` / `retired`).

4. `node src/seed.ts` regenerates `registry/*.json` from the fixtures. Never hand-edit the JSON.

5. `npm test` in the registry repo, then `npm run poll:dry` to check the live pages still parse to the same rows.

6. Commit the parser, fixture, and regenerated JSON together. The daily poller opens a review PR for anything it finds on its own; a human merging that PR is the approval step, and the poller never merges.

7. Back in the app repo, `npm test` with `REGISTRY_SOURCE=../aidep-registry/registry` to check the new row scans and transforms the way you expect.
