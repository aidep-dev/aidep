# aidep

Dependabot for AI APIs. aidep knows every OpenAI, Anthropic, and Google model and API deprecation, scans a GitHub repo for exposure, opens the migration PR, and proves the migration held by running the repo's own prompts on the old and new model in the repo's own CI.

Two repos make the product:

- **aidep** (this repo): one Next.js app. GitHub App webhook, scan pipeline, migration PR generation, eval pack generation, dashboard, public pages.
- **[aidep-registry](../aidep-registry)**: the deprecation registry as JSON, plus the parsers and the daily poller that keep it current. Clone it as a sibling directory (`../aidep-registry`), or point `REGISTRY_SOURCE` at a raw URL serving its `registry/` files.

## Run it locally

Prereqs: Node 24+, Docker, npm.

```sh
git clone <this repo> aidep && git clone <registry repo> aidep-registry
cd aidep
npm ci
docker compose up -d          # Postgres on localhost:5433
node src/db/migrate.ts        # applies db/schema.sql (idempotent)
npm test                      # 121 tests, needs the database
```

Scan any local directory without any GitHub setup:

```sh
npm run scan -- test/fixtures/fixture-repo   # the planted-exposure fixture
npm run scan -- /path/to/your/project
```

With `GITHUB_TOKEN` set, `npm run scan -- owner/repo` scans a repo by tarball.

The registry repo stands alone:

```sh
cd ../aidep-registry
npm ci && npm test
npm run poll:dry              # live check against the three provider pages
node src/seed.ts              # regenerate registry/*.json from the fixtures
```

## Register the GitHub App (needed for webhooks, onboarding PRs, the dashboard)

1. GitHub: Settings → Developer settings → GitHub Apps → New GitHub App.
2. Webhook URL: `<APP_URL>/api/github/webhook` with a secret you generate. During development, point a tunnel (cloudflared, ngrok, smee) at `localhost:3000` and use the tunnel URL as `APP_URL`.
3. Permissions, exactly three: Metadata read, Contents read and write, Pull requests read and write. Subscribe to events: Push, Pull request.
4. Enable "Request user authorization (OAuth) during installation" is not required; the dashboard uses the App's OAuth credentials with the plain web flow. Set the callback URL to `<APP_URL>/api/auth/callback`.
5. Generate a private key. Fill `.env.local` from `env.example` (private key with `\n` for newlines).
6. `npm run dev`, install the App on a repo you own, and the onboarding PR with the scan report arrives in the repo.

The onboarding PR is the whole first act: merge it to activate, close it to decline. Migration PRs are opt-in per finding from the dashboard at `/dashboard`.

## Deploy

The app is a standard Next.js deployment (built with `--webpack`) plus a Postgres. `vercel.json` ships a 10-minute cron hitting `/api/cron/drain` (set `CRON_SECRET`). Set `REGISTRY_SOURCE` to a raw URL serving the registry JSON, e.g. `https://raw.githubusercontent.com/<you>/aidep-registry/main/registry`. The registry repo needs no deployment: its daily GitHub Actions cron (`.github/workflows/poll.yml`) opens a review PR against itself when a provider page changes; merging the PR is the approval step.

## What it stores

Findings only: file path, line number, matched identifier, registry row. Repo tarballs are scanned in memory and discarded; source text is never persisted. Uninstalling the App deletes everything for that installation immediately. Details on `/security`.

## Layout

```
app/api/github/webhook   signature-verified webhook, ack fast, work via jobs
app/api/cron/drain       scheduled rescans + registry-change rescans + queue drain
src/scanner              tarball → in-memory scan → findings
src/transforms           Assistants→Responses rewrites, model swaps, param fixes
src/evalgen              eval pack: extracted cases + promptfoo configs + CI workflow
src/github               onboarding + migration PR builders
src/pipeline.ts          the jobs: scan, onboard, create_migration_pr, rerun, ingest
db/schema.sql            the whole data model
cli/scan.ts              the scanner as a CLI
```
