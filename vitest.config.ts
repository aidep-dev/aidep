import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several suites share one Postgres, and drain()/the cron recovery claim
    // from the global jobs table, so a parallel file's drain would run another
    // file's queued job. Run files serially; each file cleans its own rows.
    // (Production is safe under real concurrency via FOR UPDATE SKIP LOCKED.)
    fileParallelism: false,
  },
});
