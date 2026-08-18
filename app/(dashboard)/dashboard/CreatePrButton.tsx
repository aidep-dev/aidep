"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State =
  | { step: "idle" }
  | { step: "pending" }
  | { step: "queued" }
  | { step: "error"; message: string };

// Migration PRs are free on every repo, so there is no gate here. The paid
// line is the eval pack, and its upsell lands in the PR body (the skip reason)
// where the customer is already reading, not on this button.
export default function CreatePrButton({
  repoId,
  registryId,
}: {
  repoId: number;
  registryId: string;
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
    if (!res.ok) {
      setState({ step: "error", message: `Could not queue the PR (HTTP ${res.status}).` });
      return;
    }
    setState({ step: "queued" });
    router.refresh();
  }

  if (state.step === "queued") {
    return <span className="text-sm text-ink-secondary">PR queued</span>;
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
