---
paths:
  - "src/transforms/**"
  - "test/fixtures/transforms/**"
---

# Transforms

Corrupting customer code is far worse than under-transforming. An unrecognized shape becomes a checklist item, never a guess.

## Fixture pairs are mandatory

Every transform change needs a fixture pair under `test/fixtures/transforms/<case>/`: `input.<ext>` and `expected.<ext>`. Register the case in the `CASES` array in `test/transforms.test.ts` (append; earlier indices are referenced by index) and the snapshot test asserts the migrated output byte-for-byte. A case that is deliberately not rewritten sets `expected` equal to `input`; the test compares `migrated ?? input`.

## Boundary rules that already exist

- Never rewrite an id inside a URL or a path. The transform-local boundary (`TX_BOUNDARY_LEFT` / `TX_BOUNDARY_RIGHT` in `src/transforms/index.ts`) also refuses a `/` neighbour, so `.../models/<id>` and `evals/<id>/x` are left alone. The scanner's looser boundary still reports them; we just do not edit them.
- Sampling-param removal is scoped to the call that was swapped: the enclosing balanced paren region of each swapped line, never file-wide. Another model's call in the same file keeps its params.
- Docs files (`.md`, `.markdown`, `.mdx`, `.txt`, `.rst`, `.adoc`, anything matching `changelog`) get a checklist item, never an edit.
- Commented-out mentions are stripped before the code is read, so a comment never drives a rewrite.
- Computed or multi-line param values are reported as blocked and left in place.

## Degrade, do not guess

When a shape is only partly recognized, leave the file byte-identical (`migrated: null`) and emit a checklist item naming the file and what was and was not seen. A half-rewritten Assistants dance that mixes the new call with the old run loop is a broken repo, which is worse than no PR.

Any repo-derived fragment interpolated into checklist text or an `applied` description goes through `mdEscape`.
