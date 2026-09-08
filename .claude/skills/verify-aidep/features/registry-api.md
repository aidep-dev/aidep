# Registry API

The registry is served as JSON for other people's agents: every row at `/api/registry`, one id's fate at `/api/registry/<id>`, the row schema, and `llms.txt` telling an agent how to use them. All of it is public, CORS-open, cached an hour, and needs no database. Two bearer-protected routes report on the deployment itself.

## Sub-features

- `api-all` `GET /api/registry` is the array of rows, each with `source_url` and `verified_at`.
- `api-one` `GET /api/registry/<api_id>` returns `found`, `alive`, `row`, `chain`, `end`, `cycle`.
- `api-endpoint-id` a path like `/api/registry/v1/assistants` resolves the endpoint id `/v1/assistants`.
- `api-miss` an unknown id is 404 with `found:false` and a `file_a_row` link.
- `api-schema` `GET /api/registry/schema.json` is the JSON Schema for one row.
- `api-llms` `GET /llms.txt` is the plain-text guide.
- `api-redirect` `/replacements` redirects to `/dead#check`.
- `api-funnel` `GET /api/funnel` with the cron bearer returns counts over the local database.
- `api-check` (opt-in) `GET /api/check` with the cron bearer probes the real Anthropic key and GitHub search token.

## How to get to it (user POV)

- The "/api/registry" link in the lookup's blurb on `/dead`.
- `llms.txt` links every endpoint.
- Any agent or script with the URL.

## Driving it with verify-aidep

Preconditions:

- Doctor is all PASS; `$URL` and `$ART` are set.

- **All rows.** Run `curl -sD "$ART/api-all.headers" $URL/api/registry -o "$ART/api-all.json"; grep -iE '^(HTTP|access-control|cache-control)' "$ART/api-all.headers"`. `200`, `access-control-allow-origin: *`, `cache-control: public, max-age=3600`. Then `node -e 'const r=require(process.argv[1]);console.log(r.length, r.every(x=>x.source_url.startsWith("https://")&&/^\d{4}-\d{2}-\d{2}$/.test(x.verified_at)))' "$ART/api-all.json"` prints the row count and `true`.
- **One id.** Run `curl -s $URL/api/registry/gpt-4-turbo | tee "$ART/api-one.json"`. `found` is true, `row.id` is `openai:model:gpt-4-turbo`, `chain[0].api_id` is `gpt-4-turbo`, `alive` is a boolean, `cycle` is false.
- **Endpoint id.** Run `curl -s $URL/api/registry/v1/assistants`. `found` is true and `row.id` is `openai:endpoint:assistants-api`.
- **Miss.** Run `curl -s -w '\n%{http_code}\n' $URL/api/registry/definitely-not-a-model`. The body has `"found":false`, `"alive":null`, and a `file_a_row` URL; the last line is `404`.
- **Schema.** Run `curl -s $URL/api/registry/schema.json | tee "$ART/api-schema.json"`. `$id` is `https://aidep.dev/api/registry/schema.json`, `title` is `aidep registry row`, and `properties` has `id`, `provider`, `dies`, `replacement_id`.
- **llms.txt.** Run `curl -sD - $URL/llms.txt -o "$ART/api-llms.txt" | grep -i content-type; head -1 "$ART/api-llms.txt"`. `text/plain; charset=utf-8` and `# aidep`.
- **Redirect.** Run `curl -sI $URL/replacements | grep -iE '^(HTTP|location)'`. `308` and `location: /dead#check`.
- **Funnel (database read).** Run `curl -s -o /dev/null -w '%{http_code}\n' $URL/api/funnel`; prints `401`. With `CRON_SECRET` set in `.env.local`, `curl -s -H "authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" $URL/api/funnel | tee "$ART/api-funnel.json"` is JSON with `installs`, `repos`, `migration_prs`, `paid_orgs`, `interest`. With it empty, the local state on 2026-08-28, every bearer is `401`: the route refuses to run without a secret. Report which you saw.
- **Key probe (opt-in, real network for two of the three).** Only when asked to check the keys, and only with `CRON_SECRET` set: the same bearer against `$URL/api/check` returns `{"anthropic":{"ok":...},"search":{"ok":...},"mail":{"ok":...}}`. `anthropic` and `search` make a real call with the keys in `.env.local`; `mail` is a config check only (`RESEND_API_KEY` and `MAIL_FROM` both set), no network. Not part of a routine proof.
- **Proof.** The files above in `$ART` plus the status lines you printed.

## Gotchas

- `/api/registry` and `/api/registry/<id>` are cached for an hour by Next (`revalidate = 3600`) and by the `cache-control` header; a registry file edited mid-run does not show until the instance is rebuilt or the hour passes.
- `alive` is computed against today's UTC date; a row can flip from true to false between two runs a day apart.
- The bearer is `CRON_SECRET` from `.env.local`; never paste its value into a report. The commands above read it inline.
- `CRON_SECRET` is empty locally as of 2026-09-06 (`grep -c '^CRON_SECRET=.' .env.local` prints `0`), so the funnel and check steps end at 401 until it is set.
- `/api/check` spends money and rate limit on the `anthropic` and `search` probes only; the `mail` probe it now also returns is a local env check with no side effect.
