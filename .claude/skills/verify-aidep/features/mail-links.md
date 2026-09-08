# Confirm and stop links

The two links in every aidep mail. The confirmation link consents an address to one thing, a repo that named it in `.github/aidep.json` or the waitlist, and the stop link ends all aidep mail to that address for good. Both are a page with one button on GET and act only on POST, so a corporate link scanner that opens every URL in a mail changes nothing.

## Sub-features

- `confirm-page` GET shows one form and writes nothing.
- `confirm-post` POST writes the `confirmed_addresses` row for that scope and answers plain text saying what the address will get.
- `confirm-scope` a link minted for one scope answers 400 with any other scope, and the stop link's token cannot confirm.
- `stop-page` GET shows one form and writes nothing.
- `stop-post` POST, from the button or from the mail client's one-click body (RFC 8058), writes the `suppressed_addresses` row.
- `link-forgery` a wrong token answers 400 on both.

## How to get to it (user POV)

- The confirmation mail's link, `/api/notify/confirm?e=<address>&s=<scope>&t=<token>`, sent when a merged `.github/aidep.json` names the address (scope `repo:<id>`) or when the address joined the waitlist (scope `waitlist`). One per address per scope.
- The stop link, `/api/notify/stop?e=<address>&t=<token>`, in every mail footer and in the `List-Unsubscribe` header, which mail clients show as their own Unsubscribe button.
- No page on the site links to either; they arrive in mail only. Locally, mint them with the function the mailer uses (below).

## Driving it with verify-aidep

Preconditions:

- Doctor is all PASS; `$URL`, `$ART`, and `$RUN` are set; the address is `verify-$RUN@example.com`.
- `grep -c '^MAIL_SECRET=.' .env.local` prints `1`. Both routes answer 500 without it.
- `bash .claude/skills/verify-aidep/verify.sh sql "select count(*) from confirmed_addresses where email like 'verify-$RUN%'"` prints `0`, and the same for `suppressed_addresses`.

- **Mint the links.** Run `APP_URL=$URL node --env-file=.env.local -e "import('./src/notify.ts').then(m => console.log(m.confirmUrl('verify-$RUN@example.com', 'waitlist') + '\n' + m.stopUrl('verify-$RUN@example.com')))" | tee "$ART/mail-links-minted.txt"`. Two lines: `$URL/api/notify/confirm?e=verify-$RUN%40example.com&s=waitlist&t=<43 url-safe chars>` and `$URL/api/notify/stop?e=verify-$RUN%40example.com&t=<43 chars>`. Keep them: `CONFIRM=$(sed -n 1p "$ART/mail-links-minted.txt")` and `STOP=$(sed -n 2p "$ART/mail-links-minted.txt")`.
- **Confirm page.** Run `curl -s -D - "$CONFIRM" | tee "$ART/mail-links-confirm-get.txt"`. `HTTP/1.1 200`, `content-type: text/html`, and the body holds `<form method="post">` and `Confirm verify-$RUN@example.com for aidep mail?`. Then the `sql` count on `confirmed_addresses` still prints `0`.
- **Confirm.** Run `curl -s -D - -X POST "$CONFIRM" | tee "$ART/mail-links-confirm-post.txt"`. `HTTP/1.1 200`, `content-type: text/plain`, body `Confirmed. aidep will write to verify-$RUN@example.com when a retirement date is inside 14 days, and for nothing else. Every mail links to a stop button.` Run `bash .claude/skills/verify-aidep/verify.sh sql "select email, scope from confirmed_addresses where email = 'verify-$RUN@example.com'" | tee "$ART/mail-links-rows.txt"`. One line: `verify-$RUN@example.com|waitlist`.
- **Wrong scope.** Run `curl -s -o /dev/null -w '%{http_code}\n' -X POST "${CONFIRM/s=waitlist/s=repo:1}"`; it prints `400`. Run `curl -s -o /dev/null -w '%{http_code}\n' -X POST "${CONFIRM%t=*}t=${STOP##*t=}"` (the stop token on the confirm link); it prints `400`. The `sql` line above still shows the one row.
- **Stop page.** Run `curl -s -D - "$STOP" | tee "$ART/mail-links-stop-get.txt"`. `HTTP/1.1 200`, html with `<form method="post">` and `Stop all aidep mail to verify-$RUN@example.com?`. The `sql` count on `suppressed_addresses` prints `0`.
- **Stop, one click.** Run `curl -s -D - -X POST "$STOP" -H 'content-type: application/x-www-form-urlencoded' --data 'List-Unsubscribe=One-Click' | tee "$ART/mail-links-stop-post.txt"`. `HTTP/1.1 200`, body `Done. aidep will never mail verify-$RUN@example.com again.` Run `bash .claude/skills/verify-aidep/verify.sh sql "select email from suppressed_addresses where email = 'verify-$RUN@example.com'" | tee -a "$ART/mail-links-rows.txt"`. One line, the address.
- **Forgery.** Run `curl -s -o /dev/null -w '%{http_code}\n' -X POST "${STOP%t=*}t=forged"`; it prints `400`. Same with `$CONFIRM`.
- **Proof.** The four `-D -` captures and `mail-links-rows.txt` in `$ART`, plus the three `400` codes in the report.
- **Cleanup.** Run `bash .claude/skills/verify-aidep/verify.sh sql "delete from confirmed_addresses where email like 'verify-%@example.com'"` and the same for `suppressed_addresses`; each prints `DELETE 1`.

## Gotchas

- The link's host comes from `APP_URL` at mint time, and `.env.local` points that at the dev server (`http://localhost:3000`). The `APP_URL=$URL` in front of `node` wins over the env file, so the link points at the instance you may drive.
- The minting function lowercases the address; type it lowercase so the `sql` lookups match.
- `${CONFIRM/s=waitlist/s=repo:1}` and `${STOP##*t=}` are shell substitutions; they work the same in bash and zsh.
- Nothing here sends mail. The routes only read and write rows; the mailers run from the cron drain, which this instance never runs.
- Suppression is permanent by design and has no UI to undo it; the cleanup delete is the only way back, which is why the recipe never uses a real address.
