"use client";

import { useEffect, useId, useRef, useState } from "react";
import { findRow, replacementChain, type Chain } from "../../../src/chain.ts";
import type { RegistryRow } from "../../../src/registry.ts";
import { chipClass, daysUntil, statusLabel } from "../dates.ts";
import { PROVIDER } from "../site.ts";
import { suggest, type Suggestion } from "./suggest.ts";

const FILE_A_ROW = "https://github.com/aidep-dev/aidep-registry/issues/new?template=file-a-row.yml";

/**
 * Paste the id your model suggested; walk its replacement chain in the
 * browser against the same /api/registry any agent can read. Fetched once,
 * on focus, then every lookup and every suggestion is local. `examples` are
 * real ids the placeholder types through and the empty box offers on focus;
 * `hero` is the landing size.
 */
export function Lookup({ examples, hero = false }: { examples: string[]; hero?: boolean }) {
  const [rows, setRows] = useState<RegistryRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState<Chain | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<Promise<RegistryRow[] | null> | null>(null);
  const listId = useId();
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

  function ensureRows(): Promise<RegistryRow[] | null> {
    if (rows !== null) return Promise.resolve(rows);
    pending.current ??= fetch("/api/registry")
      .then((r) => r.json() as Promise<RegistryRow[]>)
      .then((data) => {
        setRows(data);
        return data;
      })
      .catch(() => {
        pending.current = null;
        return null;
      });
    return pending.current;
  }

  async function lookup(id: string) {
    if (rows === null) setState("loading");
    const data = await ensureRows();
    if (data === null) {
      setState("error");
      return;
    }
    setState("idle");
    // endpoint ids carry a leading slash the user probably did not type
    let found = replacementChain(data, id);
    if (found.hops.length === 0) {
      const slashed = replacementChain(data, `/${id}`);
      if (slashed.hops.length > 0) found = slashed;
    }
    setChain(found);
    setOpen(false);
  }

  function pick(s: Suggestion) {
    setQuery(s.apiId);
    setActive(-1);
    setOpen(false);
    void lookup(s.apiId);
  }

  const typed = query.trim();
  const suggestions: Suggestion[] =
    rows === null
      ? []
      : typed !== ""
        ? suggest(rows, typed)
        : examples
            .map((id) => {
              const row = findRow(rows, id);
              return row ? { row, apiId: id } : null;
            })
            .filter((s): s is Suggestion => s !== null);
  const listOpen = open && suggestions.length > 0;
  const now = new Date();

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      const n = suggestions.length;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
      return;
    }
    if (e.key === "Enter" && listOpen && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
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
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onFocus={() => {
              void ensureRows();
              setOpen(true);
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-label="Model id, endpoint or param"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-activedescendant={listOpen && active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className={hero ? "input py-4 pr-3 text-base sm:pr-12 sm:text-lg" : "input pr-3 sm:pr-10"}
          />
          <kbd className="key absolute right-3 top-1/2 hidden -translate-y-1/2 sm:block" aria-hidden>
            /
          </kbd>
          {listOpen && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Closest registry rows"
              onMouseDown={(e) => e.preventDefault()}
              className="panel absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-y-auto"
            >
              {typed === "" && <li className="label border-b border-rule px-4 py-2 text-ink-muted">try one of these</li>}
              {suggestions.map((s, i) => {
                const days = s.row.dies ? daysUntil(s.row.dies, now) : null;
                const retired = s.row.status === "retired";
                return (
                  <li
                    key={s.row.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onClick={() => pick(s)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm ${i === active ? "bg-row-hover" : ""}`}
                  >
                    <code className={retired ? "struck" : "text-ink"}>{s.apiId}</code>
                    <span className={`label inline-block px-1.5 py-0.5 ${chipClass(days, retired)}`}>
                      {statusLabel(s.row, days)}
                    </span>
                    <span className="label ml-auto text-ink-muted">{PROVIDER[s.row.provider]}</span>
                  </li>
                );
              })}
            </ul>
          )}
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
      {chain !== null && state !== "loading" && (
        <ChainView chain={chain} closest={rows ? suggest(rows, chain.query, 3) : []} onPick={pick} />
      )}
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

function ChainView({
  chain,
  closest,
  onPick,
}: {
  chain: Chain;
  closest: Suggestion[];
  onPick: (s: Suggestion) => void;
}) {
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
        {closest.length > 0 && (
          <span className="mt-2 block">
            Closest in the registry:{" "}
            {closest.map((s) => (
              <button
                key={s.row.id}
                type="button"
                onClick={() => onPick(s)}
                className="mr-3 font-mono text-ink underline underline-offset-4"
              >
                {s.apiId}
              </button>
            ))}
          </span>
        )}
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
