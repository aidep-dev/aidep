---
paths:
  - "src/registry.ts"
---

# Registry

Read-only to this app. Rows come from the aidep-registry repo (a sibling checkout in dev, a raw https base URL in prod via `REGISTRY_SOURCE`). The app loads, validates, caches, and never writes.

- To add or fix a deprecation row, change the registry repo: parser or fixture, then `node src/seed.ts` there. Never patch a row here and never ship a hardcoded row as a workaround.
- `RegistryRowSchema` mirrors `aidep-registry/src/schema.ts`. The registry repo owns the schema; a field change there has to be reflected here, not invented here.
- The registry records only what is dying, never what is alive. Anything that needs a live model id (judge candidates, for instance) hardcodes it and checks it against the registry before use.
