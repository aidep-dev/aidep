# Notify mail

A repo's `.github/aidep.json` can name addresses in `notify`. Each address gets one confirmation mail for that repo and nothing else until it presses the button behind the link. After that it gets a digest when a scan finds an event it has not been told about, and one reminder when an event's date comes within 30 days. Every mail carries a stop link that ends all aidep mail to the address for good.

## Sub-features

- `config-reread` a push that touches `.github/aidep.json` re-reads it, and the repo row stores the new config.
- `confirmation` one "Confirm your address for aidep" mail per address per repo, naming the repo; the link opens a page with one button.
- `digest` once confirmed, the next cron drain mails the repo's open events not yet announced to that address, one mail per repo.
- `reminder` an event already announced gets one more digest when its date is 30 days out or closer.
- `stop` the stop link's page has one button; pressing it ends all mail to the address, confirmations included.

## How to get to it (user POV)

- Edit `.github/aidep.json` on the default branch, set `"notify": ["you@example.com"]`, and commit.
- The mails come from watch@aidep.dev.

## Driving it with verify-aidep-github-app

Not driven yet. These steps are read from `src/notify.ts` and the confirm and stop routes; the first run that drives them replaces this paragraph with its date and evidence.

Preconditions:

- Doctor is all PASS.
- An inbox the run can read, such as a plus alias of the owner's own address read through the Gmail connector. The confirm and stop buttons are the inbox owner's to press; a run presses them only with the owner's go-ahead.
- `MAIL_FROM` in Vercel production is on aidep.dev, the domain Resend has verified.

- **Set the address.** Commit `.github/aidep.json` on main with `notify` set to the alias, changing no other key.
- **Config re-read.** With the Neon MCP, `select config::text from repos where owner = 'ricardodreyes' and name = 'aidep-canary'` shows the alias within seconds.
- **Confirmation.** Within 10 minutes the alias receives "Confirm your address for aidep", naming ricardodreyes/aidep-canary. The ledger (`select kind, subject_key, sent_at from notifications where recipient = '<alias>'`) shows `confirm` with subject key `repo:<repo id>`.
- **Confirm.** The owner opens the link and presses the button. The page answers "Confirmed. aidep will write to <alias> when a scan of ricardodreyes/aidep-canary finds a new exposure or a retirement is inside 30 days, and for nothing else." and `confirmed_addresses` holds the alias with scope `repo:<repo id>`.
- **Digest.** The next drain mails the repo's open events, with the most urgent one in the subject, and the ledger gains one `exposure` row per event.
- **Stop.** The owner presses the stop link in the digest. The page answers "Done. aidep will never mail <alias> again." and `suppressed_addresses` holds the alias.
- **Cleanup.** Commit `notify` back to `[]`. Stopping is permanent by design; lifting it for a test alias is `delete from suppressed_addresses where email = '<alias>'`, the owner's call.

## Gotchas

- Mail goes out only on the 10-minute cron drain, never inline with a push.
- The ledger announces each event to an address once, plus the one reminder, so repeating the digest step needs an event that address has not heard about.
- MAIL_FROM was `watch@aidep.com`, a parked domain Resend never verified, until 2026-09-10. The health probe only checks that the variable is set, so it read green while every send would have failed.
- aidep.dev has no DMARC record; look in spam as well.
