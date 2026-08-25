# aidep

Scan a directory for calls to retired or deprecated OpenAI, Anthropic and Google models and APIs.

```
npx aidep .
```

No account, no token, no write access. The scan runs on your machine; the only network request is
fetching the [deprecation registry](https://github.com/aidep-dev/aidep-registry), 199 dated rows
where every date carries the vendor URL it came from. Nothing about your code leaves your machine.

The output is a markdown report: every dead or dying identifier with file, line, the retirement
date, and the vendor-named replacement. Replacements are checked against the registry too, because
about one in six vendor-named replacements is itself already deprecated.

A GitHub repo works as a target as well (`npx aidep owner/repo`); that path needs a `GITHUB_TOKEN`
to fetch the tarball, which is scanned in memory and discarded.

The registry is CC0 and lives at [aidep.dev](https://aidep.dev): the
[retirement calendar](https://aidep.dev/dead), a
[replacement checker](https://aidep.dev/replacements), and a GitHub App that watches your repos
and opens the migration PR when you ask it to.
