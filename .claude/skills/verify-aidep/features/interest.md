# Waitlist and upgrade forms

Two email forms write to the same `interest` table: the landing page waitlist (source `landing-waitlist`) and the pricing page upgrade request (source `pricing-upgrade`). Both replace themselves with a confirmation line on success, both keep the form with "That didn't go through. Try again." on failure, and both are throttled to one row per address per hour without telling the visitor.

## Sub-features

- `waitlist-submit` an address on `/#waitlist` stores a `landing-waitlist` row and shows "You're on the list."
- `upgrade-submit` an address on `/pricing` stores a `pricing-upgrade` row and shows "Thanks. We reply by hand, usually the same day."
- `interest-throttle` the same source and address within an hour stores nothing new and still reports success.
- `interest-required` the field is `required` and `type=email`; the browser blocks an empty or malformed submit before any request.
- `interest-api` `POST /api/interest` with `{source, email?, context?}` answers `{"ok":true}`; a bad body answers 400 `{"error":"invalid body"}`.
- `upgrade-alert` an upgrade row also mails the operator, only when `RESEND_API_KEY` and `MAIL_FROM` are both set.

## How to get to it (user POV)

- `/` scrolled to the closing section "Install once. Hear from us when a date gets close.", or `/#waitlist`.
- The "install" button in the header and every "install on github" button go to `/#waitlist` while the GitHub App has no public slug locally.
- `/pricing`, the "Proof" panel, under the price.
- Footer link "pricing".

## Driving it with verify-aidep

Preconditions:

- Doctor is all PASS; `$URL`, `$ART`, and `$RUN` are set; the address is `verify-$RUN@example.com`.
- `grep -cE '^(RESEND_API_KEY|MAIL_FROM)=' .env.local` prints `0`. If it does not, the upgrade step sends a real email to the `MAIL_FROM` inbox: stop and say so.
- `bash .claude/skills/verify-aidep/verify.sh sql "select count(*) from interest where email like 'verify-$RUN%'"` prints `0`.

- **Reach the waitlist.** Navigate to `$URL/#waitlist`. Run `browser_navigate`, then `browser_snapshot`. In the section headed "Install once. Hear from us when a date gets close." there is a textbox "Email" and a button "Join the waitlist".
- **Join.** Enter the address and submit. Run `browser_type` on the textbox with `verify-$RUN@example.com` and submit true, `browser_wait_for` with text `You're on the list.`, then `browser_snapshot`. The form is gone; "You're on the list." stands in its place.
- **Row written.** Run `bash .claude/skills/verify-aidep/verify.sh sql "select source, email, context from interest where email = 'verify-$RUN@example.com'"`. One line: `landing-waitlist|verify-$RUN@example.com|`.
- **Throttle.** Reload and submit the same address again. Run `browser_navigate` to `$URL/#waitlist`, `browser_type` with the same address and submit true, `browser_wait_for` with text `You're on the list.`. Then the `sql` count for that address still prints `1`.
- **Upgrade.** Navigate to `$URL/pricing`. Run `browser_navigate`, `browser_snapshot`, `browser_type` on the textbox "Email" with `verify-$RUN@example.com` and submit true, then `browser_wait_for` with text `Thanks. We reply by hand`. The form under the "Proof" price is replaced by "Thanks. We reply by hand, usually the same day."
- **Second row, no mail.** Run `bash .claude/skills/verify-aidep/verify.sh sql "select source from interest where email = 'verify-$RUN@example.com' order by id"`. Two lines: `landing-waitlist` then `pricing-upgrade`. Run `grep -ci resend "$ART/server.log"`; it prints `0`, because with mail unconfigured the alert returns before logging anything.
- **API shape.** Run `curl -s -X POST $URL/api/interest -H 'content-type: application/json' -d "{\"source\":\"landing-waitlist\",\"email\":\"verify-$RUN-api@example.com\"}"`; the body is `{"ok":true}` and `sql` shows the row. Run `curl -s -o /dev/null -w '%{http_code}\n' -X POST $URL/api/interest -H 'content-type: application/json' -d '{"source":"nope"}'`; it prints `400`.
- **Proof.** Screenshot and snapshot the "You're on the list." state as `$ART/interest-waitlist-done.png` and `.aria.md`, the upgrade done state as `$ART/interest-upgrade-done.png` and `.aria.md`, and save the `sql` output as `$ART/interest-rows.txt`.
- **Cleanup.** Run `bash .claude/skills/verify-aidep/verify.sh sql "delete from interest where email like 'verify-%@example.com'"`; it prints `DELETE 3`.

## Gotchas

- Native validation: `browser_type` with submit on a non-email value shows the browser's own tooltip, which the snapshot does not capture, and sends nothing. Check `sql` for the absence of a row rather than looking for an error message.
- Success is decided by `res.ok` only; a 500 from the database shows "That didn't go through. Try again." with the form still there. Doctor's `/dead` check covers the database.
- The rows go into the same Postgres the dev server and `npm test` use. The `verify-` prefix is what keeps cleanup safe; do not invent other addresses.
- The mail check is `grep` on the server log; when mail is unconfigured nothing is logged at all, so `0` is the pass. The "mail skipped" log line belongs to the digest and waitlist mailers, not the operator alert.
- A `landing-waitlist` post with no email at all also writes a row (email null) and throttles on that; the recipe always sends an address so cleanup can find it.
- Past 60 `interest` rows in the trailing hour, the endpoint still answers `{"ok":true}` but stores nothing more; a single verification pass is nowhere near that, but running this recipe many times inside the same hour can silently stop leaving rows to clean up.
