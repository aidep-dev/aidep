import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "./auth.ts";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  return (
    <>
      <header className="border-b border-rule">
        <div className="mx-auto flex w-full max-w-5xl items-baseline justify-between px-6 py-3">
          <Link href="/" className="font-display text-2xl leading-none">
            aidep
          </Link>
          <div className="flex items-baseline gap-4 text-sm">
            <span className="text-ink-secondary">{session.login}</span>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="border border-rule px-2.5 py-1 text-ink-secondary hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
    </>
  );
}
