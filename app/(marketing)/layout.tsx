import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between px-6 py-4">
          <Link href="/" className="font-display text-2xl leading-none text-ink">
            aidep
          </Link>
          <nav className="flex items-baseline gap-6 text-sm">
            <Link href="/dead" className="text-ink-secondary hover:text-ink">
              What is dead
            </Link>
            <Link href="/security" className="text-ink-secondary hover:text-ink">
              Security
            </Link>
            <Link href="/pricing" className="text-ink-secondary hover:text-ink">
              Pricing
            </Link>
            <Link
              href="/dashboard"
              className="border border-rule px-3 py-1.5 text-ink-secondary hover:border-ink-muted hover:text-ink"
            >
              Dashboard
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-6">
        <div className="border-t border-rule py-6 text-xs text-ink-muted">
          aidep tracks model and API deprecations across OpenAI, Anthropic, and Google. We store
          findings, never your source code.
        </div>
      </footer>
    </>
  );
}
