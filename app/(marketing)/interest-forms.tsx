"use client";

import { useState } from "react";

type SendState = "idle" | "sending" | "done" | "error";

async function postInterest(body: { source: string; email?: string }): Promise<boolean> {
  try {
    const res = await fetch("/api/interest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function WaitlistForm() {
  const [state, setState] = useState<SendState>("idle");
  const [email, setEmail] = useState("");

  if (state === "done") {
    return <p className="label text-clean">You&rsquo;re on the list.</p>;
  }

  return (
    <form
      className="mt-0 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending");
        setState((await postInterest({ source: "landing-waitlist", email })) ? "done" : "error");
      }}
    >
      <div className="w-full">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          aria-label="Email"
          className="w-full border border-rule bg-paper-raised px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-muted focus:border-rule-strong focus:outline-none"
        />
        {state === "error" && (
          <p className="mt-2 text-sm text-ink-secondary">That didn&rsquo;t go through. Try again.</p>
        )}
      </div>
      <button
        type="submit"
        disabled={state === "sending"}
        className="label h-fit shrink-0 border border-rule-strong px-4 py-3 text-ink hover:border-ink hover:bg-ink hover:text-paper disabled:opacity-60"
      >
        {state === "sending" ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}

export function UpgradeButton() {
  const [state, setState] = useState<SendState>("idle");
  const [email, setEmail] = useState("");

  if (state === "done") {
    return <p className="mt-8 text-sm text-ink">Thanks. We reply by hand, usually the same day.</p>;
  }

  // Billing is a hand-flipped flag until the first few orgs exist, so the
  // one thing this has to capture is who asked. A click with no address was
  // a number on a chart and nothing else.
  return (
    <form
      className="mt-8 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending");
        setState((await postInterest({ source: "pricing-upgrade", email })) ? "done" : "error");
      }}
    >
      <div className="w-full">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          aria-label="Email"
          className="w-full border border-rule bg-paper-raised px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-muted focus:border-rule-strong focus:outline-none"
        />
        {state === "error" && (
          <p className="mt-2 text-sm text-ink-secondary">That didn&rsquo;t go through. Try again.</p>
        )}
      </div>
      <button
        type="submit"
        disabled={state === "sending"}
        className="label h-fit shrink-0 border border-rule-strong px-5 py-3 text-ink hover:border-ink hover:bg-ink hover:text-paper disabled:opacity-60"
      >
        {state === "sending" ? "One moment…" : "Upgrade"}
      </button>
    </form>
  );
}
