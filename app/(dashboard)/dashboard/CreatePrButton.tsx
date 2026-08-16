"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State =
  | { step: "idle" }
  | { step: "pending" }
  | { step: "queued" }
  | { step: "paid" }
  | { step: "requested" }
  | { step: "error"; message: string };

export default function CreatePrButton({
  repoId,
  registryId,
  repoFullName,
}: {
  repoId: number;
  registryId: string;
  repoFullName: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: "idle" });

  async function create() {
    setState({ step: "pending" });
    let res: Response;
    try {
      res = await fetch(`/api/repos/${repoId}/migrate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registryId }),
      });
    } catch {
      setState({ step: "error", message: "Network error. Try again." });
      return;
    }
    if (res.status === 402) {
      setState({ step: "paid" });
      return;
    }
    if (!res.ok) {
      setState({ step: "error", message: `Could not queue the PR (HTTP ${res.status}).` });
      return;
    }
    setState({ step: "queued" });
    router.refresh();
  }

  async function requestAccess() {
    try {
      await fetch("/api/interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "private-gate", context: repoFullName }),
      });
    } catch {
      // best-effort signal; acknowledge regardless
    }
    setState({ step: "requested" });
  }

  if (state.step === "queued") {
    return <span className="text-sm text-ink-secondary">PR queued</span>;
  }
  if (state.step === "requested") {
    return <span className="text-sm text-ink-secondary">Thanks, noted.</span>;
  }
  if (state.step === "paid") {
    return (
      <span className="flex flex-wrap items-baseline gap-3 text-sm">
        <span className="text-ink-secondary">
          Migration PRs on private repos are on the paid plan.
        </span>
        <button
          type="button"
          onClick={requestAccess}
          className="border border-rule px-2.5 py-1 text-ink-secondary hover:text-ink"
        >
          Request access
        </button>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-baseline gap-3 text-sm">
      <button
        type="button"
        onClick={create}
        disabled={state.step === "pending"}
        className="bg-ink px-3 py-1.5 text-paper disabled:opacity-60"
      >
        {state.step === "pending" ? "Opening PR…" : "Create migration PR"}
      </button>
      {state.step === "error" && <span className="text-ink-secondary">{state.message}</span>}
    </span>
  );
}
