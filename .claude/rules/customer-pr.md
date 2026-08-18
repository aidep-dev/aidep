---
paths:
  - "src/github/**"
  - "src/evalgen/**"
---

# What may be written into a customer repo

Only these paths:

- files the transform actually rewrote, at their existing paths
- `result.generatedFiles` (one-off helper scripts, under `aidep/`)
- the eval pack under `evals/`, including `evals/workflows/aidep-eval.yml`

Never `.github/workflows/`. The App holds three permissions and none of them can write a workflow file; the eval workflow ships under `evals/workflows/` and the PR body carries the move-it step. Findings under `.github/workflows/` are filtered out before the transform runs and stay report-only.

## PR bodies

Everything repo-derived that lands in a PR body goes through `mdEscape`: file paths, matched identifiers, swap cells, checklist fragments, and every field of the customer-CI-written `evals/results.json`. Our own copy does not need it; anything that came out of their repo does.

## Generated configs

Built with `JSON.stringify`, never string templates, so a repo-derived string cannot break out of its value position. Runtime files (`build-asserts.mjs`, `report.mjs`, `aidep-eval.yml`) are static templates emitted verbatim with zero interpolation, and a test asserts byte-identity with the files in `src/evalgen/templates/`.

## Banned in anything we emit

`prompt={"id":...}` and `prompt_id`, in generated code, configs, checklist text, and PR bodies alike. `/v1/prompts` dies 2026-11-30 and prompt creation is dashboard-only, so configs are always inlined. Tests assert this; do not weaken them.

## Volume

One onboarding PR per install, then nothing until it merges. Migration PRs only when a finding was explicitly requested. `prCap` in the repo config caps concurrent open migration PRs; respect it rather than routing around it.
