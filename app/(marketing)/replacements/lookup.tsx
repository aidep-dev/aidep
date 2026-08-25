"use client";

import { useState } from "react";
import { replacementChain, type Chain } from "../../../src/chain.ts";
import type { RegistryRow } from "../../../src/registry.ts";
import { chipClass, daysUntil, statusLabel } from "../dates.ts";

const FILE_A_ROW = "https://github.com/aidep-dev/aidep-registry/issues/new?template=file-a-row.yml";

/**
 * Paste the id your model suggested; walk its replacement chain in the
 * browser against the same /api/registry any agent can read. Fetched once,
 * then every lookup is local.
 */
export function Lookup() {
  const [rows, setRows] = useState<RegistryRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState<Chain | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function lookup(id: string) {
    let data = rows;
    if (data === null) {
      setState("loading");
      try {
        data = (await (await fetch("/api/registry")).json()) as RegistryRow[];
        setRows(data);
      } catch {
        setState("error");
        return;
      }
    }
    setState("idle");
    // endpoint ids carry a leading slash the user probably did not type
    let found = replacementChain(data, id);
    if (found.hops.length === 0) {
      const slashed = replacementChain(data, `/${id}`);
      if (slashed.hops.length > 0) found = slashed;
    }
    setChain(found);
  }

  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const id = query.trim();
          if (id) void lookup(id);
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="gpt-4-turbo"
          aria-label="Model id, endpoint or param"
          autoComplete="off"
          spellCheck={false}
          className="w-full max-w-md border border-rule bg-paper-raised px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-muted focus:border-rule-strong focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="label h-fit shrink-0 border border-rule-strong px-4 py-3 text-ink hover:border-ink hover:bg-ink hover:text-paper disabled:opacity-60"
        >
          {state === "loading" ? "Loading…" : "Check"}
        </button>
      </form>
      {state === "error" && (
        <p className="mt-3 text-sm text-ink-secondary">Could not load the registry. Try again.</p>
      )}
      {chain !== null && state !== "loading" && <ChainView chain={chain} />}
    </div>
  );
}

function ChainView({ chain }: { chain: Chain }) {
  const now = new Date();
  if (chain.hops.length === 0) {
    return (
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-secondary">
        <code className="text-ink">{chain.query}</code> is not in the registry. Either it is alive as far as the
        vendor has said, or we have not tracked it yet.{" "}
        <a href={FILE_A_ROW} className="text-link underline">
          File a row
        </a>{" "}
        if you know of a date.
      </p>
    );
  }
  return (
    <ol className="mt-4 max-w-2xl">
      {chain.hops.map((row, i) => {
        const days = row.dies ? daysUntil(row.dies, now) : null;
        const retired = row.status === "retired";
        return (
          <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule py-3 text-sm">
            <span className="w-6 text-xs text-ink-muted">{i === 0 ? "you" : "→"}</span>
            <code className="text-ink">{row.api_ids[0]}</code>
            <span className={`inline-block px-2 py-0.5 text-xs ${chipClass(days, retired)}`}>{statusLabel(row, days)}</span>
            <a href={row.source_url} className="text-xs text-ink-muted underline decoration-rule underline-offset-2 hover:text-ink">
              source
            </a>
          </li>
        );
      })}
      <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-sm">
        <span className="w-6 text-xs text-ink-muted">{"→"}</span>
        {chain.end !== null ? (
          <>
            <code className="text-ink">{chain.end.api_id}</code>
            <span className="text-xs text-ink-muted">not in the registry: alive as far as we know</span>
          </>
        ) : chain.cycle ? (
          <span className="text-xs text-ink-muted">the chain loops back on itself</span>
        ) : (
          <span className="text-xs text-ink-muted">no replacement announced</span>
        )}
      </li>
    </ol>
  );
}
