# Dashboard

`/dashboard` shows the signed-in GitHub user the repos, across their installations, that their own GitHub account can read: exposures, next death, open PRs, and one "Create migration PR" button per deprecation event on a repo's page. Sign-in is GitHub OAuth through the App's credentials; there is no local account.

## Sub-features

- `dash-gate` a visitor without a session is sent to sign in.
- `dash-login` `/api/auth/login` sends the browser to GitHub's authorize page with a state cookie.
- `dash-api-gate` `POST /api/repos/<id>/migrate` without a session is 401.
- `dash-logout` `POST /api/auth/logout` clears the session cookie and returns to `/`.
- `dash-index` (signed in) the "Repositories" table or "Nothing to watch yet".
- `dash-repo` (signed in) `/dashboard/<owner>/<repo>` with findings grouped by event and the PR button.
- `dash-auth-denied` a cancelled or expired OAuth attempt redirects to `/?auth=denied`, which banners every marketing page: "GitHub sign-in was cancelled or the code had expired. Nothing was stored." with a "Try again" link back to `/api/auth/login`.

## How to get to it (user POV)

- Footer link "dashboard" on every marketing page.
- `/dashboard` directly.
- The onboarding PR body links to it.

## Driving it with verify-aidep

Preconditions:

- Doctor is all PASS; `$URL` and `$ART` are set.
- `grep -c '^GITHUB_CLIENT_ID=.' .env.local` says whether the App credentials are set. As of 2026-09-01 they are empty (the App is not registered locally), so the gate, API gate, and logout steps are provable and the login step ends in a 500.
- For `dash-index` and `dash-repo` only: a browser already signed in on Ricardo's own instance (`http://localhost:3000`). See Gotchas for why that is the only way.

- **Gate.** Run `curl -sI $URL/dashboard | grep -iE '^(HTTP|location)'`. `307` and `location: /api/auth/login`.
- **Login redirect.** Run `curl -sI $URL/api/auth/login | grep -iE '^(HTTP|location|set-cookie)' | sed 's/state=[0-9a-f]*/state=<hex>/g' | tee "$ART/dashboard-login.headers"`. With `GITHUB_CLIENT_ID` set: `302`, `location` starts `https://github.com/login/oauth/authorize?client_id=` and carries `redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fcallback` and a `state=`, and `set-cookie` is `aidep_oauth_state=<hex>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`. With it empty (local, 2026-08-28): `500`, and `server.log` gains `Error: GITHUB_CLIENT_ID must be set`. Report which of the two you saw.
- **API gate.** Run `curl -s -o /dev/null -w '%{http_code}\n' -X POST $URL/api/repos/1/migrate -H 'content-type: application/json' -d '{"registryId":"openai:model:gpt-4-turbo"}'`. Prints `401`.
- **Logout.** Run `curl -sI -X POST $URL/api/auth/logout | grep -iE '^(HTTP|location|set-cookie)'`. `302`, `location: /`, and `set-cookie: aidep_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`.
- **In the browser.** Navigate to `$URL/dashboard` with the Playwright MCP. Run `browser_navigate`, then `browser_snapshot` with filename `$ART/dashboard-gate.aria.md`. With credentials set, the page is GitHub's sign-in or authorize page (the MCP profile holds no GitHub session) and the URL starts `https://github.com/login`; stop there, never sign in with any account from a verification run. With them empty (local, 2026-08-28) it is Next's "Internal Server Error" page at `$URL/api/auth/login`.
- **Auth denied banner.** Navigate to `$URL/?auth=denied`. Run `browser_navigate`, then `browser_snapshot` with filename `$ART/dashboard-auth-denied.aria.md`. Every marketing page (this component lives in the marketing layout) shows the banner text above with a link "Try again" whose href is `/api/auth/login`; a plain `$URL/` with no query has no banner. Read from source only as of 2026-09-06, needs a live instance to confirm: Postgres was down for this pass, so `verify.sh up` never started a server.
- **Signed-in index (needs Ricardo).** In Chrome where Ricardo is signed in at `http://localhost:3000/dashboard`, open `$URL/dashboard`. The `aidep_session` cookie is scoped to `localhost` with no port and is sealed with the same `SESSION_SECRET`, so this instance should render "Repositories" or "Nothing to watch yet" too. Unverified as of 2026-08-28; it needs his browser, and a report must say so rather than claim it.
- **Proof.** `dashboard-login.headers` and `dashboard-gate.aria.md` in `$ART`, plus the status codes printed above.

## Gotchas

- Sign-in cannot complete on this instance. GitHub sends the OAuth code to the callback registered on the App, `<APP_URL>/api/auth/callback`, and `APP_URL` in `.env.local` is `http://localhost:3000`, the dev server. Only Ricardo's own instance can mint a session.
- `NEXT_PUBLIC_GITHUB_APP_SLUG` is empty locally, so the "Install the GitHub App" link on the empty dashboard is a dead `#` with a note, and every "install" button on the site goes to `/#waitlist`.
- "Create migration PR" enqueues a job that opens a real pull request on the customer's repo through the GitHub App. Never click it during verification unless Ricardo named the repo and asked for the PR; unrequested PRs are the one thing this product promises never to do. A repo whose onboarding PR has not merged answers `409` instead of enqueuing (`{"error":"Merge the onboarding PR first..."}`); the API-gate curl above never reaches that check because the missing session 401s first.
- Authorization is answered by GitHub on every request, per repo (`/user/installations/<id>/repositories`), not per installation. Only a `401` (expired or revoked token) bounces to `/api/auth/login`; any other GitHub failure (5xx, rate limit, no response) now renders inline on the page instead: "GitHub did not answer (...). Try again in a minute."
- `POST /api/auth/logout` now also revokes the user's token at GitHub (best effort, ignored on failure) when a session cookie is present. The Playwright MCP's profile and the curl-based Logout step here carry no session, so this recipe never triggers a real revoke; do not run the Logout step against a browser that is actually signed in to GitHub through this app, or it kills that real session.
- Cookies carry `Secure` under `next start`; Chrome and Playwright's Chromium accept that on `http://localhost`, other hostnames would drop it.
- The `state` value in the login redirect is random per request; the `sed` in the recipe masks it so two runs' headers compare equal.
- The sealed session now carries its own issued-at timestamp and expires 7 days after signing in regardless of the cookie's `Max-Age` (`SESSION_MAX_AGE_SECONDS` in `src/auth/session.ts`); a session older than that opens as `null` and `requireSession` sends the visitor to sign in again. Matters for "Signed-in index (needs Ricardo)": a session Ricardo minted more than a week before a verification run is already dead.
