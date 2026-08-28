"use client";

import { useState, useSyncExternalStore } from "react";

// The clock as an external store, the same shape theme.tsx uses: the server
// snapshot is null, so the server HTML and the first client paint both show
// the fallback, then the live value takes over without a hydration mismatch.
// Under reduced motion the snapshot stays null and the days label stands.
function subscribeSeconds(onTick: () => void): () => void {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}
const nowSeconds = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? null : Math.floor(Date.now() / 1000);
const noSnapshot = () => null;

/**
 * Days, hours, minutes and seconds to UTC midnight of a YYYY-MM-DD, ticking
 * once a second. Renders `fallback` (the days chip text) until mounted, and
 * takes its colour from the chip around it.
 */
export function Countdown({ dies, fallback }: { dies: string; fallback: string }) {
  const now = useSyncExternalStore(subscribeSeconds, nowSeconds, noSnapshot);
  if (now === null) return <>{fallback}</>;
  const [y, m, d] = dies.split("-").map(Number);
  const s = Math.floor(Date.UTC(y, m - 1, d) / 1000) - now;
  if (s <= 0) return <>{fallback}</>;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="tabular-nums">
      {Math.floor(s / 86400)}d {pad(Math.floor((s % 86400) / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
    </span>
  );
}

/** The install line as a button: click copies it, the right cell says so for a moment. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // no clipboard access: the command is still on screen to select
        }
      }}
      className="panel inline-flex items-stretch text-left font-mono text-sm"
    >
      <code className="flex items-center gap-3 px-4 py-2.5 text-ink">
        <span className="text-ink-muted">$</span>
        <span>{command}</span>
      </code>
      <span
        aria-live="polite"
        className="label flex w-20 items-center justify-center border-l border-rule text-ink-muted"
      >
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}
