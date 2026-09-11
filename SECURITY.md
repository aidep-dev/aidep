# Security

## Reporting a vulnerability

Email security@aidep.dev. Do not open a public issue. Say what you found, how to reproduce it, and whether you want credit once it is fixed. Expect a reply within a week. Anything that lets aidep write into a repository it should not, write code it should not, or mail an address that did not consent gets fixed before any other work.

## In scope

- aidep.dev, its API under `/api/`, the dashboard, and the GitHub App at github.com/apps/aidep-dev.
- The migration PRs and eval packs aidep writes into other people's repositories. A file it should never touch, or a rewrite that is wrong in a way the PR's checklist does not name, both count.
- The `aidep` npm package.
- Mail from watch@aidep.dev: the confirmation and stop links, and the consent behind them.

The deprecation data in [aidep-registry](https://github.com/aidep-dev/aidep-registry) is public facts with citations. A wrong row is a bug there, not a vulnerability.

## What aidep holds

Findings only: a file path, a line number, a matched identifier and a registry row id. Repo tarballs are scanned in memory and discarded, and no source text is stored. The App has three permissions (metadata read, contents read and write, pull requests read and write) and never writes `.github/workflows/`. An email address is held only if someone typed it, and it gets nothing but one confirmation mail until the link is pressed. The full account is on [aidep.dev/security](https://aidep.dev/security), and the two review passes so far are in [docs/](docs/).

## Supported versions

The app at aidep.dev and the latest `aidep` on npm. A self-hosted copy tracks `master`.
