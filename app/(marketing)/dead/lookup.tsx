"use client";

import { useEffect, useRef, useState } from "react";
import { replacementChain, type Chain } from "../../../src/chain.ts";
import type { RegistryRow } from "../../../src/registry.ts";
import { chipClass, daysUntil, statusLabel } from "../dates.ts";

const FILE_A_ROW = "https://github.com/aidep-dev/aidep-registry/issues/new?template=file-a-row.yml";

/**
 * Paste the id your model suggested; walk its replacement chain in the
 * browser against the same /api/registry any agent can read. Fetched once,
 * then every lookup is local. `examples` are real ids the placeholder types
 * through so a stranger sees what to paste; `hero` is the landing size.
 */
export function Lookup({ examples, hero = false }: { examples: string[]; hero?: boolean }) {
  const [rows, setRows] = useState<RegistryRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState<Chain | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const input = useRef<HTMLInputElement>(null);
  const placeholder = useTypewriter(examples, query === "");

  // "/" focuses the box from anywhere on the page. Keyboard-initiated, so it
  // gets no animation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.defaultPrevented) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      )
        return;
      e.preventDefault();
      input.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
        <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Model id, endpoint or param"
            autoComplete="off"
            spellCheck={false}
            className={hero ? "input py-4 pr-3 text-base sm:pr-12 sm:text-lg" : "input pr-3 sm:pr-10"}
          />
          <kbd className="key absolute right-3 top-1/2 hidden -translate-y-1/2 sm:block" aria-hidden>
            /
          </kbd>
        </div>
        <button
          type="submit"
          disabled={state === "loading"}
          className={hero ? "btn btn-accent shrink-0 px-6" : "btn btn-accent shrink-0 px-4"}
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

/**
 * Types through the examples in the placeholder: 55ms a character in, a
 * pause, 28ms a character out. Stops the moment the reader types, and never
 * starts under reduced motion, where the first example stays put.
 */
function useTypewriter(words: string[], active: boolean): string {
  const [text, setText] = useState(words[0] ?? "");
  const key = words.join("|");
  useEffect(() => {
    if (!active || words.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let word = 0;
    let len = words[0].length;
    let deleting = false;
    let timer = 0;
    function step() {
      const w = words[word];
      if (deleting) {
        len -= 1;
        setText(w.slice(0, len));
        if (len <= 0) {
          deleting = false;
          word = (word + 1) % words.length;
          timer = window.setTimeout(step, 320);
          return;
        }
        timer = window.setTimeout(step, 28);
        return;
      }
      len += 1;
      setText(w.slice(0, len));
      if (len >= w.length) {
        deleting = true;
        timer = window.setTimeout(step, 1800);
        return;
      }
      timer = window.setTimeout(step, 55);
    }
    timer = window.setTimeout(step, 1400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for `words`
  }, [key, active]);
  return text;
}

/* The hop marker: an arrow for the eye, a word for a screen reader. */
function Then() {
  return (
    <>
      <span aria-hidden>→</span>
      <span className="sr-only">then</span>
    </>
  );
}

function ChainView({ chain }: { chain: Chain }) {
  const now = new Date();
  if (chain.hops.length === 0) {
    return (
      <p className="reveal mt-4 max-w-2xl text-left text-sm leading-relaxed text-ink-secondary">
        <code className="text-ink">{chain.query}</code> is not in the registry. Either it is alive as far as the
        vendor has said, or we have not tracked it yet.{" "}
        <a href={FILE_A_ROW} className="text-ink underline underline-offset-4">
          File a row
        </a>{" "}
        if you know of a date.
      </p>
    );
  }
  return (
    <ol key={chain.query} className="panel mt-4 max-w-2xl text-left">
      {chain.hops.map((row, i) => {
        const days = row.dies ? daysUntil(row.dies, now) : null;
        const retired = row.status === "retired";
        return (
          <li
            key={row.id}
            style={{ "--i": i } as React.CSSProperties}
            className="reveal flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule px-4 py-3 text-sm"
          >
            <span className="label w-8 text-ink-muted">{i === 0 ? "you" : <Then />}</span>
            <code className={retired ? "struck" : "text-ink"}>{row.api_ids[0]}</code>
            <span className={`label inline-block px-1.5 py-0.5 ${chipClass(days, retired)}`}>{statusLabel(row, days)}</span>
            <a href={row.source_url} className="label text-ink-muted underline decoration-rule-strong underline-offset-2 hover:text-ink">
              source
            </a>
          </li>
        );
      })}
      <li
        style={{ "--i": chain.hops.length } as React.CSSProperties}
        className="reveal flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm"
      >
        <span className="label w-8 text-ink-muted">
          <Then />
        </span>
        {chain.end !== null ? (
          <>
            <code className="text-ink">{chain.end.api_id}</code>
            <span className="label text-clean">alive as far as we know</span>
          </>
        ) : chain.cycle ? (
          <span className="label text-ink-muted">the chain loops back on itself</span>
        ) : (
          <span className="label text-ink-muted">no replacement announced</span>
        )}
      </li>
    </ol>
  );
}
