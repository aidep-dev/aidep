# Security review, 2026-08-28

Scope: everything that lands on a stranger's screen or a customer's repo before the App goes public: the webhook and App handlers, dashboard auth, the API routes, mail and interest capture, the eval egress and secrets, the registry loader, scanner and transforms, the workflows and deploy config, and the promises on /security, /pricing and the handbook against the code. Seven independent read-only passes, one per boundary, run on the tree at `aba6d36` plus the uncommitted verify skill. Everything found is listed; severity is a judgement, not a filter. Status is as of the same evening: fixed means the change is in the tree with a test; open means a product or operator call.

Counts: 2 blockers, 14 high, 23 medium, 48 low, 54 notes.

## Blockers, high and medium

### F1. Blocker, open: `ROADMAP.md:92`

The repo is private, but ROADMAP.md (rendered live at /roadmap) says 'Push aidep public, MIT' shipped on 2026-08-21 and 'The app is open source too'; /security's self-hosting link and the handbook's DECISIONS.md link point at that private repo and 404 for everyone but the operator.

Fix: Flip the repo public after the CLI publish and the evidence fix below, or edit ROADMAP Phase 0 today to mark those two items open. Update 'Last updated 2026-08-21' (ROADMAP.md:4) and add the Phase 1 outcome (window closed 08-28, gate not met).

### F2. Blocker, open: `app/(marketing)/page.tsx:98`

The live landing page, llms.txt, the waitlist mail, the handbook and both READMEs tell people to run `npx aidep .`, and the package does not exist on npm. The name is unclaimed, so once the README is public anyone can take it.

Fix: `cd cli && npm publish` (prepublishOnly runs the root build; npm login with 2FA first). Do this before the repo or the App goes public. `npm pack --dry-run` already shows the right 11 files (dist, README.md, LICENSE, package.json).

### F3. High, fixed: `.github/workflows/health.yml:6`

A red health run is not reliably seen. The only sink is GitHub's failed-run email to whoever last committed the workflow file, which depends on that account's notification settings; the run has been red since 19:29Z on 08-28 with no fix in the repo, and it was red on 08-22 and 08-23 before CRON_SECRET existed. On a public repo GitHub also disables scheduled workflows after 60 days without a push, so the check can stop silently.

Fix: Add a `if: failure()` step with a second sink that does not depend on notification settings: `permissions: issues: write` plus `gh issue create --title 'health red'` (dedupe by label), or a curl to Resend using a RESEND_API_KEY secret to the MAIL_FROM mailbox. Add a keepalive (any monthly commit, or `workflow_dispatch` from another cron) so the 60-day rule never disables it.

### F4. High, open: `.github/workflows/health.yml:22`

The production GITHUB_SEARCH_TOKEN is dead: the daily probe returns GitHub 401 Bad credentials. /dead's exposure counts stop refreshing and refreshExposure counts every request as skipped without logging. Most likely the classic token was regenerated when SEARCH_TOKEN was created in Actions the same morning and the Vercel copy kept the old value.

Fix: Paste the current token into the Vercel env GITHUB_SEARCH_TOKEN (Sensitive) and redeploy, then `gh workflow run health.yml` and confirm green. Keep one token, set in both places on the same day, and note its expiry in the operator todo.

### F5. High, fixed: `app/api/github/webhook/route.ts:42`

A handler failure is swallowed with no log line, and the design relies on GitHub redelivering the 500, which GitHub does not do automatically for App webhooks (failed deliveries sit in the delivery log until someone redelivers by hand or via POST /app/hook/deliveries/{id}/attempts). Net effect: an installation.created that fails once (DB blip, cold-start timeout) means no onboarding PR ever, no retry, and nothing in the function logs to notice it by. octokit registers no default error handler either: state.hooks.error is empty unless webhooks.onError is called, and @octokit/app does not call it.

Fix: Log before returning: `catch (e) { console.error("webhook", req.headers.get("x-github-delivery"), req.headers.get("x-github-event"), e); return new Response("handler error", { status: 500 }); }`. Then make redelivery real: either persist the raw delivery (id, event, body) in a webhook_deliveries table before dispatch and have the cron drain re-run rows that never finished, or add a cron step that lists failed deliveries via GET /app/hook/deliveries and redelivers them. Fix the comment at :25-26 and the matching line in docs/security-review-2026-08-21.md.

### F6. High, fixed: `app/api/interest/route.ts:19`

Unauthenticated, unrate-limited endpoint that now drives outbound mail. The only brake is one row per (source, email) per hour, so distinct addresses are unlimited. Every distinct landing-waitlist address gets one confirmation mail from our sender the next time the cron drains (once Resend is wired), and every pricing-upgrade POST with a fresh address sends one operatorAlert mail. An attacker with a list of victim addresses turns aidep.dev into a mail cannon: N POSTs = N unsolicited mails from our domain, plus Resend quota and sender-reputation burn, plus an operator inbox flood. The 2026-08-21 review scored this low because the table was inert; the confirmation step (its fix for finding 2) made it a channel. It also inflates /api/funnel waitlist_emails and upgrade_clicks.

Fix: Three brakes, any two are enough before Resend goes live: (1) a Vercel Firewall rate-limit rule on POST /api/interest (say 5/min per IP) or a DB bucket keyed on the first x-forwarded-for hop; (2) a per-run ceiling in sendDueNotifications, e.g. stop after 25 confirmations and let the next cron continue, so a flood costs days not minutes and is visible in the drain JSON; (3) Cloudflare Turnstile on the landing and pricing forms, verified server-side in this route. Also cap operatorAlert to one mail per hour regardless of email (collapse the rest into the next one).

### F7. High, fixed: `app/api/interest/route.ts:19`

The public, unauthenticated endpoint is an outbound-mail amplifier. Every distinct landing-waitlist address inserted gets one confirmation mail from aidep's Resend domain on the next cron drain (every 10 minutes, vercel.json), and there is no per-IP limit, no captcha, no global cap, and no per-run cap on confirmations. The only brake is one row per exact (source, email) string per hour. An attacker with a list of addresses turns aidep into a spam relay at zero cost: Resend quota gone, bounces and spam reports against the sending domain, and every legitimate digest afterwards lands in spam. The cron also spends its whole function budget sending them (sequential Resend calls). Prior review #6 called this low because the table was inert; it is not inert any more.

Fix: Three layers, cheapest first. (1) In sendDueNotifications, cap confirmations per run (e.g. `if (confirmations >= 25) break;` in both loops) so the blast radius per cron is bounded whatever the table holds. (2) Per-IP throttle on POST /api/interest: add an `ip text` column (from `x-forwarded-for` first hop, or `x-real-ip` on Vercel) and refuse when `count(*) from interest where ip = $ip and created_at > now() - interval '1 hour' >= 5`; or a Vercel WAF rate-limit rule on the path, which needs no code. (3) Cloudflare Turnstile (free) on both forms in interest-forms.tsx with the token verified server-side in the route. Also normalise on insert: `lower(trim(email))`, and throttle on the normalised value.

### F8. High, fixed: `app/api/notify/confirm/route.ts:11`

Both confirm and stop are state-changing GETs with no interstitial. Corporate link scanners (Microsoft Defender Safe Links, Mimecast, Proofpoint) and some webmail prefetchers follow every URL in an incoming mail. Consequence one: the confirm link is 'clicked' by the scanner, which re-opens prior findings #1 and #2 for any recipient behind one (attacker lists victim@corp in notify, the scanner confirms it, the next drain sends the digest with attacker-controlled repo paths). Consequence two: the stop link in the first digest is 'clicked' too, so the address is suppressed forever after one mail, with no reversal path. Net effect for corporate recipients: consent they never gave, then a permanent stop they never asked for.

Fix: Keep the GET but make it inert: return a minimal HTML page (`<form method="post"><input type="hidden" name="e"><input type="hidden" name="t"><button>Confirm</button></form>`, same for Stop) and move the insert into an exported `POST` that reads `await req.formData()` and runs the same `confirmTokenMatches` check. Scanners do not submit forms. For stop, additionally send RFC 8058 headers from resendMailer (`headers: { "List-Unsubscribe": `<${stopUrl(to)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }`), which is POST by spec and lets Gmail/Yahoo show their own unsubscribe button. Update test/notify.test.ts to call the POST handlers (confirmRoute/stopRoute at :131, :211).

### F9. High, fixed: `app/api/repos/[repoId]/migrate/route.ts:33`

A migration PR can be requested and opened while the onboarding PR is still unmerged. AGENTS.md: 'One onboarding PR on install. Nothing else until it merges (onboarded_at stays null and every other trigger returns early)'. This route is the one trigger that does not return early: it checks session, repo access and the cap, never repo.onboarded_at. Findings already exist at that point because the onboarding job scans and persists them before opening the PR, and the dashboard renders the Create migration PR button for any event group without an open PR, onboarded or not.

Fix: In the route, after requireRepoAccess: `if (repo.onboarded_at === null) return Response.json({ error: "Merge the onboarding PR first; aidep opens nothing else until then." }, { status: 409 });`. Same guard at the top of createMigrationPr in src/pipeline.ts (after getRepo) so a job queued before the check cannot outrun it. In page.tsx render the button only when `cfg` is set, with the onboarding PR link in its place. Update the two 200 tests in test/auth.test.ts to call markOnboarded first, and add one asserting 409 on a not-yet-onboarded repo.

### F10. High, fixed: `src/auth/access.ts:69`

Authorization is answered at installation granularity, not repo granularity. GET /user/installations lists every installation where the user can access at least one repo, so an outside collaborator on a single repo of an org-wide install passes the check for every repo in that installation: the index lists them all (name, private flag, finding counts, next death), the repo page shows paths, lines and matched identifiers of private repos the user cannot read on GitHub, and POST /api/repos/{id}/migrate opens PRs on them using the App's installation token. Borders blocker for any org install.

Fix: Check repo-level access: in requireRepoAccess call GET /user/installations/{repo.installation_id}/repositories (paginate, per_page=100) and require repo.id in the returned ids; in the index page, for each installation id fetch that same endpoint and pass the resulting repo id list to repoIndex (filter `r.id = any(...)`), or fetch all accessible repos once via GET /user/repos?... and intersect. Add a test where the stub returns the installation but not the repo and expect 403/404.

### F11. High, fixed: `src/evalgen/extract.ts:107`

Whole file content of every affected file is sent to Anthropic with no exclusion for dotenv/secret files and no redaction, so a committed .env (or any file with a hardcoded key) next to a matched identifier leaves the customer repo for a third party. Nothing about the egress is gated on file type.

Fix: In extractCases, skip files whose basename matches /^\.env(\..+)?$|\.(pem|key|p12|pfx)$|^(secrets?|credentials?)\./i (they carry no prompts anyway) and, before the call, redact key-shaped strings in the remaining content: /\b(sk-(?:ant-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/ and /\b[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*[=:]\s*['"]?\S+/ to `[redacted]`. Add a test with a .env file and a `api_key="sk-..."` line asserting the llm never receives the secret. Then add one sentence to /security and the onboarding PR body (AGENTS.md: changing the egress means changing both).

### F12. High, fixed: `src/evalgen/templates/report.mjs:139`

`git push origin HEAD` cannot succeed on a pull_request run: actions/checkout checks out refs/pull/N/merge as a detached HEAD, so the results.json commit never reaches the aidep/ branch, the push webhook never enqueues ingest_eval_results, prs.eval_status stays 'pending' and the PR body never shows held/drifted. The PR comment still posts, so the failure is silent (caught at report.mjs:150-154, exit 0).

Fix: Either check out the head branch in aidep-eval.yml (`with: ref: ${{ github.head_ref || github.ref }}`) or push explicitly in report.mjs: `git("push", "origin", `HEAD:refs/heads/${process.env.GITHUB_HEAD_REF}`)` with a guard when GITHUB_HEAD_REF is unset (workflow_dispatch). Add a test that runs report.mjs without --dry-run against a local bare remote and asserts results.json lands on the branch.

### F13. High, fixed: `src/scanner/patterns.ts:21`

PARAM_MODEL_GATE has an unbounded `(?:[a-z]+-)*` and is tested against the whole file text (scan.ts:69) for every file, and again in transforms/index.ts:146-153. `claude-` repeated is itself a `[a-z]+-` group, so a file of `claude-claude-claude-...` is quadratic: 7K chars 8.5 ms, 14K 33 ms, 28K 123 ms, 56K 490 ms, extrapolating to minutes at 1 MB. Same blast radius as the finding above.

Fix: Bound the family segments: `/claude-(?:[a-z]+-){0,4}(?:4-[7-9]|[5-9])(?![0-9])|claude-mythos/`. Measured 8.6 ms on 1 MB; still matches claude-opus-4-8, claude-haiku-5, claude-opus-4-7-20260101, claude-mythos-5 and still rejects claude-sonnet-4-6 and claude-3-5-sonnet-20240620.

### F14. High, fixed: `src/scanner/patterns.ts:89`

Catastrophic backtracking in a line matcher that runs on every line of every scanned file. `[A-Z0-9_]*ASSISTANT_ID[A-Z0-9_]*` is quadratic on any long run of underscores (the lookbehind only protects against alphanumerics). Measured: 5K chars 13 ms, 10K 49 ms, 20K 171 ms, 40K 691 ms, so a single 1 MB line (allowed by MAX_BYTES) extrapolates to roughly 8 minutes per file per regex. Anyone who installs the App on their own repo and pushes a file like this stalls the scan job past the serverless limit; jobs.ts retries it 5 times with backoff, and drain() (src/jobs.ts:79) runs jobs sequentially so every other tenant's queue waits behind each attempt. The CLI hangs on the same input when a stranger runs `npx aidep owner/repo` against a hostile repo.

Fix: Bound the prefix and drop the useless suffix: `/(?<![A-Za-z0-9])[A-Z0-9_]{0,64}ASSISTANT_ID/`. Measured 145 ms on a 1 MB underscore line. Same edit for the copy at src/transforms/assistants.ts:789.

### F15. High, fixed: `src/transforms/index.ts:34`

The model swap rewrites every boundary-separated occurrence of a registry id in a flagged file, with no quote or comment context, and unlike the scanner (patterns.ts:120-152) it has no isDistinctiveId guard. Dictionary-word ids with a replacement exist in the live registry (openai:model:ada -> babbage-002, curie, davinci, babbage, o1-2024-12-17 -> gpt-5.6-sol with api_id `o1`, gpt-4-0613 with api_id `gpt-4`). Proven with the live rows: `ada = client.embeddings.create(model="ada", input=text)` becomes `babbage-002 = client.embeddings.create(model="babbage-002", ...)` and `o1, o2 := split(x)` becomes `gpt-5.6-sol, o2 := split(x)`. Both are syntax errors shipped in a migration PR. AGENTS.md says corrupting customer code is far worse than under-transforming; this is the transform layer guessing.

Fix: Export isDistinctiveId from patterns.ts and reuse it in idRegex: a non-distinctive id only rewrites inside matched quotes, `(['"])id\1` with the replacement keeping the quote (use a replacer function, which also stops `$` sequences in newModel from being interpreted by String.replace at line 190). For every id, run the swap on stripLineComments output or skip lines whose match sits past the comment start, so a commented mention never drives an edit; the .claude/rules/transforms.md file already promises this. Add a fixture pair with a bare `ada` identifier and a bare `o1` variable next to a quoted pin.

### F16. High, fixed: `evidence/recount/2026-08-29.json:12`

The third Phase 1 count is a search artifact committed as fact: 227 and 153 files against 16,448 and 12,384 the day before, a 98.6% one-day drop with the same token and the same query. tools/recount.ts reads only total_count and ignores GitHub's incomplete_results flag, so a truncated search passes the 'a zero on a date is a lie' guard. The 26th and 27th have no file at all (those runs failed on the impossible GITHUB_ secret name), and the file is dated by run time, so GitHub's 7-hour cron delay labelled the 08-28 slot as 08-29.

Fix: In tools/recount.ts parse `incomplete_results` and exit 1 when true; also refuse a count that moves more than ~50% from the latest committed file and print both. Either delete 2026-08-29.json and re-dispatch, or add a `note` field marking it as an incomplete search. Take the date from the scheduled slot or a workflow input rather than the clock. Rewrite the launch post's opening around the numbers that actually exist (08-18, 08-28) and say why the other two are missing.

### F17. Medium, fixed: `.github/workflows/ci.yml:38`

CI never runs `next build`. Typegen, typecheck, lint, vitest and the CLI build run, but a prerender failure (home, /dead and /pricing call loadRegistry at build with revalidate 3600; /roadmap and llms.txt are force-static) passes CI and only surfaces as a failed Vercel deploy, so a PR merges green while prod stays on the previous build. It has not bitten yet: all 20 recent Vercel deployments are READY.

Fix: Add `- run: npm run build` after `npm test` (REGISTRY_SOURCE and DATABASE_URL are already in the job env). Add `- run: npm run lint:slop` if the anti-slop rules are meant to gate merges.

### F18. Medium, open: `app/(marketing)/security/page.tsx:112`

The '30-day' digest does not exist. The page, the onboarding PR body, the config schema comment and the notify.ts header all say a notify address is mailed 'when a scan finds a new exposure or a retirement is inside 30 days'. The ledger key is `${repo_id}:${registry_id}` with no second key, so each event is announced exactly once, whenever it is first seen. isUrgentEvent only changes the subject line of that one mail. An exposure found 200 days out gets one mail then; nothing arrives when the date enters the last 30 days. Known gap 1.

Fix: Either build it or unsay it. Build: a second key per event, `${repo_id}:${registry_id}:30d`, added to `keys` only when `isUrgentEvent(e.dies, today)`, so an already-announced event gets one more mail when it crosses the window (the mail body already handles a mixed list). Unsay: change all four sentences to 'when a scan finds a new exposure; the subject says so when the date is inside 30 days'. Pick one and change all four places in the same commit; AGENTS.md's 'changing the egress means changing both' rule applies to this copy too.

### F19. Medium, fixed: `app/api/cron/drain/route.ts:105`

refreshExposure runs before drain and is not wrapped. Its loadRegistry() call throws on a registry-source outage (raw.githubusercontent down, bad JSON), which 500s the route before drain(runJob) at line 108 ever runs. Because the failure leaves exposure_counts.counted_at stale, every 10-minute cron repeats it, so the customer job queue (scans, onboarding, migration PRs) stops draining for the whole outage, once the 20-hour staleness window is reached. The sibling rescanOnRegistryChange guards the same call; this one does not. Reliability, not confidentiality, but it takes the product down.

Fix: Wrap it like notifications: `try { if (stale) exposure = await refreshExposure({ token: ghToken }); } catch (e) { console.error("exposure refresh failed:", e); }`. Consider moving it after `drain()` so customer jobs never queue behind a public-stats refresh.

### F20. Medium, fixed: `app/api/interest/route.ts:28`

Every distinct pricing-upgrade address sends one operator mail synchronously in the request, carrying up to 2000 characters of attacker-supplied `context` verbatim, from aidep's own sender to aidep's own inbox. Unbounded distinct addresses means unbounded operator mail (inbox flood plus Resend quota), and the body is a clean phishing carrier aimed at the one person who will read it in a hurry because the page promised a same-day reply.

Fix: Same per-IP throttle as the waitlist finding, plus coalesce the alert: at most one operator mail per hour (`select 1 from notifications where kind='operator' and subject_key = date_trunc('hour', now())::text`), body 'N new upgrade intents since HH:00, see /api/funnel', no user text. If you want the address in the mail, keep it and drop `context` (nothing on the pricing form sends it anyway; interest-forms.tsx:75 posts only source and email).

### F21. Medium, fixed: `app/robots.ts:7`

robots.txt disallows /api/ for every user agent, which covers /api/registry, /api/registry/{id} and /api/registry/schema.json, the three URLs llms.txt tells agents to fetch ('Make this call before recommending a model'). Robots-honouring agent crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, most LLM retrieval tools) will refuse the registry, so the agent-facing surface the launch leans on is blocked by our own file. Not a security hole, listed because the operator asked for the conflict specifically.

Fix: `rules: { userAgent: "*", allow: ["/", "/api/registry"], disallow: ["/dashboard", "/api/"] }`. Google and most parsers apply the most specific (longest) matching rule, so /api/registry wins over /api/; for first-match parsers the allow is listed first. Alternative that avoids parser differences: enumerate the private prefixes instead (`/api/auth/`, `/api/cron/`, `/api/check`, `/api/funnel`, `/api/interest`, `/api/notify/`, `/api/repos/`, `/api/github/`).

### F22. Medium, fixed: `src/auth/session.ts:8`

Prior review item 5 still open: the sealed payload has no issued-at or absolute expiry, so the 7-day Max-Age is enforced only by the browser; a captured cookie value is valid until SESSION_SECRET rotates. Logout clears the cookie but never revokes the GitHub user token inside it, so the token stays usable after sign-out. Whether GitHub's own 8-hour user-token expiry applies depends on the App's 'Expire user authorization tokens' setting, which README.md:52 does not mention.

Fix: Add `iat: number` to Session, set Date.now() in sealSession, and in openSession return null when `Date.now() - s.iat > 7 * 24 * 3600 * 1000` (one field, one compare). On logout, read the session and call `DELETE https://api.github.com/applications/{GITHUB_CLIENT_ID}/token` with body `{access_token}` and basic auth client_id:client_secret before clearing the cookie. Confirm 'Expire user authorization tokens' is on for the App and note it in the README step 4.

### F23. Medium, fixed: `src/db/index.ts:5`

The connection has no ssl, pool, or timeout settings. TLS depends entirely on the DATABASE_URL, and postgres.js maps `sslmode=require` (the common Supabase/Neon string) to TLS without certificate verification. Defaults are max 10 connections per instance, idle_timeout null (never closed), no statement_timeout; on Vercel Fluid that is 10 long-lived connections per warm instance against a small managed Postgres, and a runaway query holds a function until maxDuration.

Fix: `postgres(url, { onnotice: () => {}, ssl: process.env.NODE_ENV === "production" ? "verify-full" : false, max: 5, idle_timeout: 20, max_lifetime: 60 * 30, connect_timeout: 10, connection: { application_name: "aidep", statement_timeout: 30000 } })`. If the host's CA is not in the system store, pass `ssl: { ca: process.env.DATABASE_CA }` and add DATABASE_CA to env.example. If the Supabase transaction pooler (port 6543) is used, add `prepare: false`. Document the chosen URL shape in env.example.

### F24. Medium, fixed: `src/evalgen/templates/aidep-eval.yml:14`

The GITHUB_TOKEN with contents:write and pull-requests:write is available to the whole job, including the two promptfoo steps that execute PR-editable code (javascript asserts from tests.json, any file:// or exec: provider someone edits into promptfooconfig.json) while holding OPENAI/ANTHROPIC/GOOGLE keys. actions/checkout persists the token in .git/config by default, so those steps can push to any branch with it. Fork PRs are safe (pull_request, not pull_request_target: no secrets, read-only token) but they still trigger the workflow on any evals/** touch and go red.

Fix: Split into two jobs: `eval` with `permissions: contents: read`, `persist-credentials: false`, the model keys, and `actions/upload-artifact` of evals/run.json and evals/baseline.json; `report` with `needs: eval`, `permissions: contents: write, pull-requests: write`, no model keys, download-artifact then `node evals/report.mjs`. Optionally `if: github.event.pull_request.head.repo.full_name == github.repository` on the eval job so fork PRs do not produce red runs.

### F25. Medium, fixed: `src/github/handlers.ts:91`

Deleting .github/aidep.json does not turn anything off. The push handler only rereads config when a commit added or modified the path, not removed it, and even a reread that 404s keeps the stored config. So `evals: true` (the Anthropic egress) and `notify` addresses outlive the file that the onboarding PR body says "controls everything". A user who removes the file to opt out keeps sending affected files to Anthropic on the next migration PR.

Fix: Simplest: drop the `touched` gate and reread the config on every scan (one contents GET, already cheap), then in scanRepo distinguish 404 from transient: `if (statusOf(e) === 404) { config = DEFAULT_CONFIG; await setRepoConfig(repoId, config); repo.config = config; }` and keep the stored config only for non-404 errors. That also covers the truncated-commits case in the note on handlers.ts:90. If keeping the gate, add `(c.removed ?? []).includes(p)` to touched.

### F26. Medium, open: `src/notify.ts:66`

Mail tokens are HMACs under SESSION_SECRET, the same secret that seals dashboard sessions. The prior review (#5) names rotating SESSION_SECRET as the way to revoke a stolen session cookie; doing that now also invalidates every confirm and stop link already delivered. Every 'Stop with one click' in every inbox starts answering 400 'that link is not valid', which breaks the /security promise at the exact moment the operator is responding to an incident.

Fix: A dedicated `MAIL_SECRET` env var for the mail HMAC, failing closed when unset outside development (same pattern as SESSION_SECRET). Accept an optional `MAIL_SECRET_PREVIOUS` in confirmTokenMatches (try both) so a mail-secret rotation does not orphan links either. One line in .env.example and the Vercel project.

### F27. Medium, open: `src/notify.ts:84`

Confirmation is global per address, not per thing consented to. The confirmation mail scopes the ask to one repo ('Someone put this address in .github/aidep.json on acme/bot'), but the row it creates is keyed on email alone. Once any address is confirmed for any reason, it receives (a) exposure digests for every other repo that ever lists it in `notify`, and (b) waitlist mail if anyone POSTs it to /api/interest as landing-waitlist, with no new confirmation. That is the prior review's #1 exploit (throwaway repo, `notify: [victim]`, paths that carry a message) against every address that has ever confirmed, i.e. every real aidep user, and the only defence the victim has is the permanent stop link, which also kills their legitimate mail.

Fix: Scope the consent. `confirmed_addresses (email text, scope text, primary key (email, scope))` with scope `repo:<repo_id>` or `waitlist`; `confirmToken(email, scope)` = HMAC over `${scope}\n${email.toLowerCase()}`; confirmUrl/confirmMail take the scope; confirmedSet(emails, scope). The notify loop passes `repo:${repo.repo_id}`, the waitlist loop passes `waitlist`. The ledger key for the confirmation mail becomes `${scope}` instead of the literal 'confirm' so a second repo can ask once. Stop stays global (a stop is a stop).

### F28. Medium, fixed: `src/notify.ts:115`

'Every mail carries a one-click stop link' is false for the confirmation mail, which is the one mail sent to people who may never have asked for anything. Its only advice is 'do nothing', and there is no List-Unsubscribe header on any mail, so mail clients cannot surface their own stop button either. Known gap 2.

Fix: Add a last line to confirmMail: `Not you, or never want to hear from aidep at this address? One click: ${stopUrl(to)}`, drop the `!m.subject.startsWith("Confirm")` filter at test/notify.test.ts:238, and pass `headers: { "List-Unsubscribe": `<${stopUrl(mail.to)}>` }` in resendMailer (or add an optional `headers` field to Mail).

### F29. Medium, fixed: `src/pipeline.ts:495`

The one-PR-until-onboarded invariant is enforced only for the push trigger. createMigrationPr never checks onboarded_at, and the migrate route does not either, so an authenticated member of the repo can POST /api/repos/{id}/migrate while the onboarding PR is still open (findings already exist from the onboarding scan, onboardRepo calls scanRepo which calls recordFindings) and aidep opens a second PR before the first merges. AGENTS.md says every other trigger returns early; this one does not. The dashboard only hides the button.

Fix: In createMigrationPr, right after the getRepo null check: `if (repo.onboarded_at === null) { console.log(`create_migration_pr: repo ${repoId} not onboarded, skipping`); return; }` (the job is where both the route and any future caller meet). In the migrate route return 409 with a one-line reason when `repo.onboarded_at === null` so the user hears why. Add a test next to handlers.test.ts:193.

### F30. Medium, fixed: `src/scanner/report.ts:48`

Repo paths are treated as hostile input, but mdEscape only escapes markdown punctuation. Git allows any byte except NUL and `/` in a filename, and tarball.ts:21 passes the path through untouched, so a filename carrying `\n` or ESC reaches the PR body, the dashboard, and the CLI's stdout. Proven: a path `a\n\n# injected heading\n\nhttps://evil.example | x` renders `# injected heading` as its own line in the report, and a path with `\x1b[31m` and an OSC 8 hyperlink sequence reaches stdout intact (terminal injection when a stranger runs `npx aidep owner/repo` on a hostile repo). `<`/`>` are escaped so no HTML lands, but headings, autolinks and list items do. A `../../etc/passwd` path from a hand-built tar is also accepted and persisted (GitHub itself cannot produce that, so low on the App side).

Fix: Sanitise at ingestion, once, where every path enters: in untarToFiles and loadLocalDir replace `[\x00-\x1f\x7f]` with `?` (or drop the entry) and skip any path with a `..` segment. Add a report.test.ts case with a newline and an ESC in the path.

### F31. Medium, fixed: `src/scanner/tarball.ts:18`

No memory bound anywhere on the tarball path. pipeline.ts:168 calls `gunzipSync(toBuffer(tar.data))` with no maxOutputLength (Buffer MAX_LENGTH on this Node is 8 TB, so the only ceiling is the function's RAM), untarToFiles buffers every File entry in full and decodes it to a string before scan.ts:31 can apply the 1 MB cap, and there is no file-count cap. Git stores a 99 MB file of zeros as a few KB, so a repo of such files yields a ~1 MB tarball that expands to gigabytes inside the drain function; the job OOMs, is retried 5 times, and each attempt blocks the shared queue. Proven that a 3 MB entry is fully materialised (`big.bin` came out at 3145728 chars) before scan.ts skipped it.

Fix: In onReadEntry, `if (entry.size > MAX_BYTES) { entry.resume(); return; }` (move MAX_BYTES to types.ts or export it from scan.ts) and stop after N files (a few thousand). In pipeline.ts:168 and cli/scan.ts:45 pass `{ maxOutputLength: 256 * 1024 * 1024 }` to gunzipSync so a bomb throws a RangeError instead of exhausting memory.

### F32. Medium, fixed: `src/transforms/assistants.ts:512`

msgVar and runVar are captured with `[\w$]+` but interpolated into regexes unescaped, so a `$`-prefixed variable turns into an end anchor. The idiom regex never matches and, worse, the leftover-use guard at lines 543-544 (`\b$msgs\b`) never matches either, so the dance is rewritten while the variable is still used. Proven: with `const $msgs = await openai.beta.threads.messages.list(threadId)` followed by `audit($msgs.data.length)` the output deletes the list call and leaves two `$msgs` references to an undefined variable, with an empty checklist; the same file with `msgs` correctly degrades to the manual-run-loop checklist.

Fix: Wrap with the existing reEscape (line 150): `reEscape(msgVar)` at 512 and 519, `reEscape(msgVar)` / `reEscape(runVar)` at 543-544, and use the `(?<![A-Za-z0-9_$])...(?![A-Za-z0-9_$])` boundary already used at line 748 instead of `\b`, which does not treat `$` as a word char.

### F33. Medium, fixed: `src/transforms/assistants.ts:830`

The thread-backfill rule has `[A-Z0-9_]*THREAD_ID[A-Z0-9_]*` with no lookbehind at all, so it is quadratic on any long run of uppercase letters, digits or underscores, not just underscores. Measured on plain `A` runs: 5K 22 ms, 10K 83 ms, 20K 324 ms, 40K 1233 ms. It runs on the full content of every file passed to a migration build (files.some at line 1009). Only the repo's own user can trigger a migration job, but the drain loop is shared, so a stuck job delays every tenant. Also `thread_[A-Za-z0-9]{6,}` here and `asst_[A-Za-z0-9]{6,}` at line 788 use the old {6,} floor that patterns.ts:39-45 replaced with 16 after `thread_channel` produced 12 false findings; here a false hit adds the backfill checklist and generates aidep/backfill-threads.mjs into the PR.

Fix: `/(?<![A-Za-z0-9_])thread_[A-Za-z0-9]{16,}(?![A-Za-z0-9_])|(?<![A-Za-z0-9])[A-Z0-9_]{0,64}THREAD_ID|threads\.retrieve/`, and import ID_LITERAL_MIN from patterns.ts for both literal rules so the two files cannot drift again.

### F34. Medium, fixed: `src/transforms/index.ts:62`

enclosingParenRange is quote-aware but not comment-aware and never resets `quote` at end of line, so an apostrophe in a trailing comment (`# don't change`) swallows the rest of the file. The range then falls back to the single swapped line (line 209), the sampling param on the next line is neither removed nor reported, and the PR ships a call that 400s on the new model with no checklist item. Proven with the live claude-2.0 -> claude-opus-4-8 row: with `# do not change` the temperature is dropped and a model-params-dropped item appears; with `# don't change` the migrated file keeps `temperature=0.5` and both checklists are empty. Apostrophes in comments are common, so this is the usual case, not the edge.

Fix: Feed enclosingParenRange the stripLineComments output (already in the file at line 107) and reset `quote` at each line end. When the range still falls back to `[ln, ln]` while removeSamplingParams found nothing, push a `param-manual` checklist item for the file so the user is told to check sampling params by hand.

### F35. Medium, fixed: `app/api/check/route.ts:45`

The health probe covers ANTHROPIC_API_KEY and GITHUB_SEARCH_TOKEN only. If RESEND_API_KEY or MAIL_FROM is unset or wrong, mailConfigured() is false, sendDueNotifications returns zeros without a log line, and operatorAlert is a no-op, so the /security confirmation-mail promise and the pricing page's 'we reply by hand' both silently stop. The operator todo says Resend is still being wired.

Fix: Add `mail: { ok: mailConfigured(), detail }` to /api/check (optionally a Resend `domains.list()` call to prove the key), and extend the jq assertion in health.yml to `.mail.ok`.

### F36. Medium, fixed: `app/api/interest/route.ts:32`

Prior finding 6 escalated: an unauthenticated POST with source pricing-upgrade and a fresh email now sends one Resend mail to the operator per distinct address per hour, with no global brake. Looping synthetic addresses burns the Resend quota that confirmation mails share (free tier 100/day), so real notify and waitlist confirmations stop going out, and the operator inbox floods.

Fix: Global brake in the same route: count pricing-upgrade rows in the last hour and skip the alert (still insert the row) above a small N, or send one hourly roll-up from the cron drain instead of one mail per row.

### F37. Medium, fixed: `app/api/notify/stop/route.ts:12`

Confirm and stop are GET requests that mutate state on first fetch. Corporate mail scanners and link prefetchers (Outlook Safe Links, Gmail, Slack unfurls) fetch every URL in a mail, so a stop link can suppress an address forever without a human click, and a confirm link can confirm one. Stop is irreversible by design ('the row outranks everything forever'), so one scanner disables mail for a whole company domain.

Fix: Have GET render a one-line page with a form and do the write on POST (same HMAC in a hidden field). For stop, RFC 8058 style: keep the GET landing page, mutate on POST. Alternatively make stop reversible by letting a later valid confirm link clear the suppressed row.

### F38. Medium, fixed: `app/api/repos/[repoId]/migrate/route.ts:47`

AGENTS.md says nothing but the onboarding PR happens until it merges. Push and cron scans honour onboarded_at, and the dashboard hides the button, but the migrate route and the create_migration_pr job never check it, so a direct POST by a repo owner opens a migration PR while the onboarding PR is still open. The invariant lives in the UI only.

Fix: In the migrate route, after requireRepoAccess: `if (repo.onboarded_at === null) return Response.json({ error: "merge the onboarding PR first" }, { status: 409 });`. That is where every caller meets; the job then never sees a pre-onboarding request.

### F39. Medium, open: `src/notify.ts:281`

The handbook and /security promise a digest 'when a scan finds a new exposure or a retirement is inside 30 days'. The code sends each (repo, registry_id) exactly once, ever; the 30-day window only changes the subject line. An exposure announced in August with a December date gets no reminder when it crosses T-30. The file's own header comment claims the reminder too.

Fix: Add a second ledger key for the urgent pass, e.g. `${repo_id}:${registry_id}:t30`, and include events with isUrgentEvent true whose t30 key is unsent; or reword the promise to 'once per new exposure' on both pages.

## Low and notes

One line each; the file and line say where. `fixed` means a builder took it in the same pass.

- F40 (low, fixed) `.github/workflows/ci.yml:5`: No `permissions:` block, so the CI job token gets the repository default scope rather than the read-only it needs; health.yml already does this right with `permissions: {}`.
- F41 (low, open) `.github/workflows/health.yml:21`: Prior finding 4 still open as accepted: the probe body is printed to the Actions log, which becomes public with the repo.
- F42 (low, open) `.github/workflows/recount.yml:8`: The schedule `0 18 26-28 8 *` has no year, so it fires again on 2026-08-26..28 of every year and commits new evidence files with the 2026 baseline's method text; combined with run-time dating in tools/recount.ts a delayed slot lands on the wrong day, which already happened.
- F43 (low, fixed) `app/(dashboard)/dashboard/page.tsx:52`: Any failure of getUserInstallationIds (GitHub 5xx, 403 rate limit, network) is treated as an expired token and redirects to /api/auth/login, which mints a fresh user token and lands back on the page, which fails again.
- F44 (low, open) `app/(marketing)/security/page.tsx:107`: 'We hold an email address only if you typed it: into notify in .github/aidep.json, or the waitlist form.' The pricing page's upgrade form is a third source; its rows sit in the same `interest` table indefinitely.
- F45 (low, fixed) `app/api/auth/callback/route.ts:15`: GitHub errors mid-flow are not handled: a user who clicks Cancel arrives with ?error=access_denied and gets a bare 401 'missing code'; a stale or reused code (back button, double callback) makes exchangeCode throw and Next returns a 500; fetchViewer failures do the same.
- F46 (low, open) `app/api/cron/drain/route.ts:46`: No `export const maxDuration`.
- F47 (low, open) `app/api/funnel/route.ts:12`: One CRON_SECRET unlocks three surfaces (drain, check, funnel) and the same value sits in GitHub Actions secrets for health.yml.
- F48 (low, open) `app/api/github/webhook/route.ts:21`: When GITHUB_WEBHOOK_SECRET is unset, getApp() throws after the body is read and before verify, and the throw is uncaught, so the route answers with a Next 500 and a stack in the function log rather than a deliberate refusal.
- F49 (low, open) `app/api/github/webhook/route.ts:37`: No replay or duplicate-delivery protection.
- F50 (low, open) `app/api/interest/route.ts:19`: Carried from the 08-21 review (item 6), still open: unauthenticated callers can insert unlimited distinct rows (one per address per hour), and since 21bb297 a pricing-upgrade row also sends the operator a mail each time, so the endpoint is now an operator-inbox flood vector as well as a funnel-count skew.
- F51 (low, fixed) `app/api/interest/route.ts:21`: The hourly throttle keys on the exact string.
- F52 (low, fixed) `app/api/notify/confirm/route.ts:19`: The confirm response is wrong for two of the three people who reach it.
- F53 (low, open) `app/api/notify/stop/route.ts:18`: Suppression is one GET, permanent, and invisible: no route, no operator alert, and no documented SQL undoes it.
- F54 (low, open) `app/api/registry/[...id]/route.ts:22`: Double URL decoding.
- F55 (low, open) `app/api/registry/[...id]/route.ts:28`: The 404 branch carries the same `public, max-age=3600` as hits and the route exports revalidate = 3600, so every distinct unknown path becomes an hour-long ISR cache entry on Vercel.
- F56 (low, open) `app/api/repos/[repoId]/migrate/route.ts:26`: CSRF protection on the two state-changing endpoints (migrate, logout) rests entirely on SameSite=Lax.
- F57 (low, open) `app/api/repos/[repoId]/migrate/route.ts:47`: No dedupe of pending create_migration_pr jobs: every click inserts a row, N clicks queue N jobs.
- F58 (low, fixed) `cli/scan.ts:42`: The tarball download and gunzip are unbounded on the user's machine: `arrayBuffer()` of the whole response, then gunzipSync with no maxOutputLength, then untarToFiles buffering every entry.
- F59 (low, open) `db/schema.sql:122`: jobs rows are never pruned: every push and every daily cron adds one, done and failed rows stay forever, and the three hot queries on it (push debounce, both cron left-joins) filter on `(payload->>'repoId')::bigint` with no index; the only index is partial on run_after for queued rows.
- F60 (low, fixed) `next.config.ts:3`: No security headers and X-Powered-By is on.
- F61 (low, open) `src/auth/session.ts:16`: SESSION_SECRET is used for two unrelated purposes without domain separation: the AES-256-GCM session key (sha256 of the secret) and the HMAC behind the mail confirm/stop links (raw secret).
- F62 (low, open) `src/auth/session.ts:21`: Carried from the 08-21 review (item 5), still open: sealed cookie has no issued_at, so a stolen value works for the full seven-day Max-Age with no server-side revocation short of rotating SESSION_SECRET.
- F63 (low, fixed) `src/evalgen/extract.ts:129`: The Anthropic fetch has no timeout.
- F64 (low, open) `src/evalgen/templates/build-asserts.mjs:66`: The `similar` assert uses promptfoo's default embedding provider (OpenAI text-embedding-3-large), so the workflow needs OPENAI_API_KEY even for Anthropic and Google packs; without it every case errors to inconclusive.
- F65 (low, open) `src/github/handlers.ts:66`: installation_repositories.removed deletes the repo row but leaves that repo's queued jobs behind, unlike deleteInstallation which deletes jobs first.
- F66 (low, open) `src/github/handlers.ts:86`: Suspended installations are only filtered in the cron.
- F67 (low, open) `src/github/handlers.ts:182`: pull_request.edited has two gaps: (a) `changes.body` is undefined on a title-only edit, so `from` becomes "" and any edit made while the box is still checked (between the tick and aidep's body refresh) enqueues another onboard/rerun job; (b) it never calls getRepo, and there is no debounce, so a collaborator ticking and unticking the box generates one job per edit, each one a tarball download and, on a paid repo with evals on, an Anthropic extraction per affected file.
- F68 (low, open) `src/github/migration.ts:386`: Branch collision is treated as ownership.
- F69 (low, open) `src/github/migration.ts:403`: The never-write-.github/workflows rule has one enforcement point (path filtering in buildMigrationForEvent) and none at the write site.
- F70 (low, open) `src/jobs.ts:88`: fail() stores the full stack (up to 2000 chars) in jobs.last_error.
- F71 (low, open) `src/notify.ts:63`: The token binds only the lowercased address: no purpose, no issue time, no nonce.
- F72 (low, open) `src/pipeline.ts:345`: A pack (and the extraction spend) ships for a model whose old id is already retired or past its dies date.
- F73 (low, open) `src/registry.ts:20`: source_url is `z.url()` with no scheme refine, while migration_url two lines up is refined to https because a dashboard renders it as an href.
- F74 (low, fixed) `src/registry.ts:43`: The https fetch has no `res.ok` check and no timeout.
- F75 (low, open) `src/scanner/local.ts:20`: Every regular file under the target is read into memory in full before scan.ts:31 can discard it by size, and the walk descends into dist/build/vendor/.next (only .git and node_modules are pruned, as the comment admits).
- F76 (low, open) `src/transforms/index.ts:291`: Every endpoint other than the Assistants row, and every header and feature surface, returns untouched files with no checklist item at all.
- F77 (low, fixed) `src/transforms/params.ts:28`: The param name from the registry (`event.api_ids`, index.ts:264) is interpolated into a regex without escaping.
- F78 (low, open) `test/notify.test.ts:44`: The suite is not isolated from the shared database.
- F79 (low, open) `README.md:21`: Stale test counts and a hosting contradiction in public docs: README says 190 tests, ROADMAP says 220, the suite has 245; README recommends Supabase Free while ROADMAP says the live database is Neon.
- F80 (low, open) `app/api/cron/drain/route.ts:108`: No explicit maxDuration on the drain route.
- F81 (low, open) `cli/package.json:20`: npm publish readiness is otherwise fine; two small things: `repository.url` points at the private repo, so the npm page's Repository link 404s until the flip, and `engines.node >=20` is looser than the root README's Node 24+ (correct for the compiled dist, which uses only fetch, node:fs, tar and zod).
- F82 (low, open) `docs/launch-post.md:45`: DECISIONS.md:94 says 'internal docs live in docs/', yet docs/ ships in the repo that ROADMAP calls open source: the launch draft with placeholders and 'account with posting history if HN', the discovery doc with a named maintainer's quoted issue comment and interview targets, and the security review.
- F83 (low, fixed) `env.example:27`: `GITHUB_TOKEN`, which README.md:31 and cli/scan.ts:30 require for `npm run scan -- owner/repo`, is not listed in env.example, so a new setup following the README hits the exit-1 path.
- F84 (low, open) `handbook/index.md:37`: Four public numbers are typed in by hand and drift with the daily poller: '174 rows .
- F85 (low, open) `src/auth/session.ts:8`: Prior finding 5 still open: the sealed cookie has no issued_at, so a stolen value works for the full seven-day Max-Age until SESSION_SECRET rotates; GitHub re-answers authorization per request, which bounds the damage.
- F86 (low, open) `src/notify.ts:213`: Prior finding 3 still open as accepted: repo-derived paths go into plain-text mail unescaped; consent gating means only a confirmed address for that repo can receive them.
- F87 (low, open) `test/notify.test.ts:70`: The digest test asserts on the total number of mails sent while sendDueNotifications reads the whole interest and repos tables; any row outside the test's DOMAIN (left by another suite, a local run, or the verify skill) adds a confirmation mail and fails the assertion.
- F88 (note, open) `.claude/skills/verify-aidep/SKILL.md:84`: Untracked verification skill (SKILL.md, verify.sh, features/) names the operator by first name and carries localhost URLs; the pending .gitignore edit excludes only .run/ and artifacts/, so a `git add -A` publishes the rest.
- F89 (note, open) `app/(dashboard)/dashboard/[owner]/[repo]/page.tsx:47`: Not-found and not-allowed both return 404 (good, no enumeration by status), but the not-allowed path performs a GitHub round trip after the DB hit while the not-found path returns immediately, so response time reveals whether aidep is installed on a given private owner/repo.
- F90 (note, open) `app/(marketing)/security/page.tsx:97`: Disclosure of the egress on /security and in the onboarding PR body agree with each other and with the code (affected files, once each, our key, opt-in), but neither names the model, Anthropic's API retention, nor that dotenv/secret files are among "affected files" today (finding 1).
- F91 (note, open) `app/(marketing)/security/page.tsx:125`: /security says the Anthropic key is 'used only to draft eval cases from your code when you opt in'; /api/check sends a fixed one-word prompt with that key daily.
- F92 (note, open) `app/api/check/route.ts:28`: Each hit spends one Anthropic call and one of the 10-per-minute code-search requests, on a budget shared with refreshExposure and recount.yml; a probe landing mid-refresh costs one skipped count.
- F93 (note, open) `app/api/cron/drain/route.ts:46`: Only GET is exported; Next derives HEAD from GET, so `HEAD /api/cron/drain` with the bearer runs a full drain and discards the body.
- F94 (note, open) `app/api/github/webhook/route.ts:13`: after(() => drain(runJob)) runs up to 20 jobs with no maxDuration export on the route, and scanRepo holds the whole gunzipped tarball in memory with no size cap.
- F95 (note, open) `app/api/interest/route.ts:13`: The body is parsed with no size check.
- F96 (note, open) `app/api/notify/confirm/route.ts:12`: Both routes carry the address and the token in the query string, so Vercel's request logs hold `e=<address>&t=<capability>` for every click, and the stop capability never expires.
- F97 (note, open) `app/api/registry/[...id]/route.ts:36`: `alive` is computed from the server clock inside a response cached for an hour, so on a retirement day the cached `alive: true` can be served up to an hour past 00:00 UTC.
- F98 (note, open) `app/api/registry/route.ts:16`: CORS sets access-control-allow-origin only and no route exports OPTIONS, so a browser caller that adds any non-simple header (Authorization, a custom X- header) preflights and fails.
- F99 (note, open) `app/api/repos/[repoId]/migrate/route.ts:32`: Number() on the path segment accepts aliases like '1e3', '0x10', ' 12 ' for integer ids.
- F100 (note, open) `app/api/repos/[repoId]/migrate/route.ts:32`: `Number()` on the path segment accepts '1e3', '0x10' and ' 12 ' as ids.
- F101 (note, open) `cli/package.json:4`: The npm description says "No account, no token, nothing leaves your machine", but the `owner/repo` mode needs GITHUB_TOKEN and sends it to api.github.com (cli/scan.ts:30-36).
- F102 (note, open) `cli/package.json:25`: Consumers of `npx aidep` resolve tar and zod fresh at install time from the caret ranges; the root package-lock.json (tar 7.5.22, zod 4.4.3) does not travel with a published package, so a bad upstream release inside the range runs on strangers' machines before you see it.
- F103 (note, open) `cli/scan.ts:29`: The slug check accepts `..` segments, so `npx aidep ../..` sends the token to `https://api.github.com/repos/../../tarball`, which the URL parser folds to `https://api.github.com/tarball`.
- F104 (note, open) `db/schema.sql:15`: No unique index on repos(owner, name), and owner/name refresh only on installation events (handlers.ts:36-39), not on push.
- F105 (note, open) `db/schema.sql:86`: The schema comment lists two ledger kinds but the code writes three; the third is the one that enforces the 'one confirmation ever' promise, so it is the one a reader most needs to know about.
- F106 (note, open) `docs/security-review-2026-08-21.md:103`: The prior review's webhook line rests on the same wrong premise as finding 1 ("handler failure is a 500 so GitHub redelivers").
- F107 (note, fixed) `env.example:24`: Env var diff.
- F108 (note, open) `src/auth/access.ts:22`: Cookie hardening left on the table: no __Host- prefix (would make the browser enforce Secure, Path=/ and no Domain rather than trusting the server header), and starting a second login in another tab overwrites the state cookie so the first tab's callback fails with 401.
- F109 (note, open) `src/auth/access.ts:63`: Suspended installations are recorded (handlers.ts sets suspended_at on installation.suspend) but neither the dashboard nor requireRepoAccess consults it; a member of a suspended install can still view findings and enqueue a migrate job that fails later at the installation-token step.
- F110 (note, open) `src/auth/github.ts:11`: With APP_URL unset in production the redirect_uri silently becomes http://localhost:3000/api/auth/callback.
- F111 (note, open) `src/auth/github.ts:44`: fetchViewer casts the GitHub response without validating it.
- F112 (note, open) `src/auth/session.ts:16`: SESSION_SECRET does double duty: the cookie AES key (sha256 of it) and the notify confirm-link HMAC key.
- F113 (note, open) `src/config.ts:17`: zod 4 deprecates `z.string().email()` in favour of `z.email()`; four call sites use the old form.
- F114 (note, open) `src/db/index.ts:26`: installation.deleted purges jobs, installations, and by cascade repos/scans/findings/prs, but notifications rows keyed `repo_id:registry_id` with the recipient address survive.
- F115 (note, open) `src/db/migrate.ts:5`: Migrations are idempotent (schema.sql uses create table/index if not exists and add column if not exists throughout) but nothing in the deploy path runs them; a deploy that adds a column 500s until someone runs migrate.ts against production by hand.
- F116 (note, open) `src/evalgen/extract.ts:95`: The prompt-file branch (verbatim .txt/.md cases, no LLM call) is unreachable in production: the scanner skips prose extensions, so no finding, so no such file ever reaches extraction.
- F117 (note, open) `src/evalgen/extract.ts:127`: The default extraction model claude-haiku-4-5 is not in the registry as deprecated or retired today (checked ../aidep-registry: no api_ids match haiku-4-5; only claude-3-haiku-20240307 and claude-3-5-haiku-20241022 are retired), and AIDEP_EXTRACT_MODEL overrides it unvalidated.
- F118 (note, open) `src/evalgen/templates/aidep-eval.yml:22`: Third-party actions are pinned by major tag (checkout@v4, setup-node@v4, cache@v4) and `npx -y promptfoo@0.122.0` pins the package but not its dependency tree, in a job that holds the customer's model keys.
- F119 (note, open) `src/evalgen/templates/report.mjs:85`: The PR comment embeds case description and details unescaped in markdown.
- F120 (note, open) `src/github/handlers.ts:56`: installation.created on an org that picks "all repositories" runs one upsert plus one enqueue per repo, sequentially, inside the webhook handler.
- F121 (note, open) `src/github/handlers.ts:90`: payload.commits is capped by GitHub (2048 commits, and file lists are dropped on very large pushes), so touched(CONFIG_PATH) can miss a config change inside a huge push; the stored config stays until the next config-touching push.
- F122 (note, open) `src/github/handlers.ts:121`: The onboarding merge check is by PR number only.
- F123 (note, open) `src/github/handlers.ts:160`: parseConfig errors are discarded at both call sites.
- F124 (note, open) `src/jobs.ts:88`: The full `e.stack` (2000 chars) is persisted in jobs.last_error.
- F125 (note, open) `src/notify.ts:44`: The unconfigured branch of resendMailer logs the recipient address to stdout.
- F126 (note, open) `src/notify.ts:61`: APP_URL falls back to https://aidep.example while the mail copy hardcodes 'aidep.dev' in two places and the security page derives security@<host> from the same variable.
- F127 (note, open) `src/notify.ts:213`: Prior review #3 still open: repo-derived paths go into the digest with no length cap.
- F128 (note, open) `src/notify.ts:267`: Operational, from the operator todo (memory file, 2026-08-28): Resend vars are live in Vercel Production but the prod migrate for suppressed_addresses has not run.
- F129 (note, open) `src/notify.ts:276`: Delivery is at-least-once, not exactly-once: the ledger row is written after the mailer resolves, so a database failure between the two resends on the next run, and two concurrent drains (the cron plus a manual bearer hit) both pass the check-then-send window.
- F130 (note, open) `src/pipeline.ts:480`: prCap is checked in the route and again in the job, but two create_migration_pr jobs claimed by concurrent drains (after() plus cron; SKIP LOCKED gives each a different row) both see open < prCap and both open a PR.
- F131 (note, open) `src/registry.ts:15`: replacement_id is an unconstrained string.
- F132 (note, fixed) `src/registry.ts:43`: The https registry fetch has no res.ok check and no timeout; a 404/500 body throws inside JSON.parse with a confusing message.
- F133 (note, open) `src/scanner/scan.ts:32`: Binary detection only looks for NUL in the first 8 KB, so a binary with a text-like header (a PDF, a tar, a font with a long ASCII preamble) is decoded and scanned in full.
- F134 (note, open) `src/scanner/tarball.ts:12`: The Parser has no 'warn' listener.
- F135 (note, open) `src/transforms/index.ts:236`: replacement_notes (line 236) and source_url (line 303) are interpolated into checklist text without mdEscape.
- F136 (note, open) `test/migration.test.ts:697`: The gate that matters for the egress is only half-tested: the unpaid test injects a canned llm but never asserts it was not called, and no migration-path test runs with evals:false (every seedRepo that sets evals passes true).
- F137 (note, open) `vercel.json:1`: Only the cron is configured: `*/10 * * * *` needs a Pro plan (Hobby crons run at most daily), and no security headers are set anywhere (next.config.ts carries one redirect; Vercel adds HSTS on its own).
- F138 (note, open) `ROADMAP.md:104`: Phase 1's window (08-26 to 08-28) has closed with the gate unmet (two usable numbers, not three), the page still reads as if it is in progress, and the registry repo's daily poller PRs show `action_required` on their CI (bot PRs need a click to run checks), so the 'a human merges it' step happens without a green check unless approved first.
- F139 (note, open) `app/(marketing)/security/page.tsx:115`: Two small gaps between /security's inbox section and the code: 'Every mail carries a one-click stop link' is true except for the confirmation mail itself (which instead says 'do nothing'), and 'Uninstalling purges all stored findings' is true while the notifications, confirmed_addresses, suppressed_addresses and interest rows keyed by email survive uninstall; the page does not say addresses persist.
- F140 (note, open) `app/(marketing)/security/page.tsx:160`: security@aidep.dev is promised as the vulnerability contact; nothing in the repo shows the mailbox exists, and there is no /.well-known/security.txt (no public/ directory), which scanners and researchers look for first.
- F141 (note, open) `vercel.json:1`: The 10-minute cron requires Vercel Pro (Hobby allows once a day); ROADMAP says Pro, and the cron has been running, so this is consistent.

## Second pass over the transforms fix

The customer-PR reviewer read the transforms and scanner hunks before anything shipped and found four things the fixes had introduced or left silent, all corrected the same evening:

- The paren-range helper reset its quote state at every line end, so a `(` inside a triple-quoted string or template literal counted as real code. A later call on another model could lose its sampling params, and a `)` inside the swapped call's own prompt could close the range early and leave a param that 400s. Fixed: triple quotes and backticks keep their state across lines; only a stray `'` or `"` resets at a line end. Two regression tests carry the reviewer's exact inputs.
- The quote-only rewrite rule used the scanner's `isDistinctiveId`, which also rejects `gpt-4`, `gpt-audio`, `computer-use-preview` and ten more real ids, so their bare occurrences went unswapped with no checklist item. Fixed: the rule is now "no separator at all" (`ada`, `curie`, `davinci`, `babbage`, `o1`), and every bare occurrence of such an id gets a `model-bare-id` checklist item.
- The ingest cap of 5000 files dropped the rest of a large archive silently. Fixed: the ingest reports what it skipped and cut, the report ends with a line saying the scan is a floor, and oversized entries count as skipped.
- `safePath` covered C0 and DEL only; Unicode bidi controls now become `?` too.

Still open from that pass: a Python triple-quoted prompt containing a lone `)` was already silent at HEAD (params.ts has no string awareness) and stays so; `"ada"` inside a language list such as `["ada", "c", "cpp"]` is still rewritten with confidence.

## What to do next time

Run this again before Oct 23 with the same everything-found rule, against whatever lands between now and then. The two blockers here were not code: an unpublished package name and a page that says the repo is public while it is not. The highs that were code cluster in three places: authorization answered at the wrong granularity, links that mutate on GET, and inputs that reach a regex or a third party unbounded.
