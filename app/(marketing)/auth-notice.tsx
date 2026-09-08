"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function Notice() {
  const denied = useSearchParams().get("auth") === "denied";
  if (!denied) return null;
  return (
    <p className="border-b border-rule bg-paper-raised px-6 py-3 text-center text-sm text-ink-secondary">
      GitHub sign-in was cancelled or the code had expired. Nothing was stored.{" "}
      <a href="/api/auth/login" className="text-ink underline underline-offset-4">
        Try again
      </a>
      .
    </p>
  );
}

/** The one line the OAuth callback has to say when it sends someone back here without a session. */
export function AuthNotice() {
  return (
    <Suspense fallback={null}>
      <Notice />
    </Suspense>
  );
}
