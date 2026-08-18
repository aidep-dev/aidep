---
name: new-transform
description: Add or change a transform in src/transforms and prove it with a fixture pair. Use when a deprecation needs a new automatic rewrite, or an existing rewrite misses a shape.
---

1. Write the transform in `src/transforms/`. Model swaps and the doc/param boundaries live in `index.ts`; the Assistants rewrites in `assistants.ts`; sampling-param removal in `params.ts`. Reuse `idRegex`, `isDocPath`, `enclosingParenRange`, and `mdEscape` rather than writing new matching.

2. Add the fixture pair: `test/fixtures/transforms/<case>/input.<ext>` and `expected.<ext>`, where `<ext>` is `py` or `js`. Write the input as the customer would actually have written it, not as a minimal probe. For a shape that must be left alone, make `expected` byte-identical to `input`.

3. Register the case at the END of the `CASES` array in `test/transforms.test.ts` (earlier entries are referenced by index):

   ```ts
   { name: "<case>", event: <ROW>, input: "input.py", expected: "expected.py", path: "src/<plausible>.py" },
   ```

   The registry rows in that file are inline hermetic copies. If the case needs a row that is not there yet, copy the real row from `../aidep-registry/registry/*.json`.

4. Run `npx vitest run test/transforms.test.ts`. The snapshot test compares `migrated ?? input` byte-for-byte.

5. Confirm safe degradation. Feed the transform a near-miss of the shape you just handled (a partial dance, a computed param value, an id inside a URL, a mention in a `.md` file) and check that it returns `migrated: null` or leaves that line alone, and emits a checklist item naming the file. If it rewrites the near-miss, the matcher is too loose. Under-transforming is fine; corrupting a customer repo is not.

6. `npm run typecheck` and `npm test`. The full suite needs the docker Postgres: `docker compose up -d`.
