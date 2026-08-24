import Link from "next/link";
import { Wordmark } from "../mark.tsx";
import { ThemeToggle } from "../theme.tsx";

/* The header carries the product and the trust. Everything else is in the footer. */
const NAV = [
  { href: "/dead", label: "dead" },
  { href: "/security", label: "security" },
];
const FOOTER_NAV = [
  ...NAV,
  { href: "/replacements", label: "replacements" },
  { href: "/handbook", label: "handbook" },
  { href: "/roadmap", label: "roadmap" },
  { href: "/pricing", label: "pricing" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  const installUrl = slug ? `https://github.com/apps/${slug}/installations/new` : "/#waitlist";

  return (
    <div className="grid-field flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <Link href="/" className="text-xl text-ink">
            <Wordmark />
          </Link>

          <nav className="label hidden items-center gap-7 text-ink-secondary md:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="label flex items-center gap-4">
            <a
              href={installUrl}
              className="border border-rule-strong px-3 py-1.5 text-ink hover:border-ink hover:bg-ink hover:text-paper"
            >
              install
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-5">
          <div className="label flex flex-wrap items-center gap-x-6 gap-y-2 text-ink-muted">
            <span className="text-sm normal-case text-ink-secondary">
              <Wordmark />
            </span>
            {FOOTER_NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-ink">
                {item.label}
              </Link>
            ))}
            <Link href="/dashboard" className="hover:text-ink">
              dashboard
            </Link>
            <ThemeToggle />
          </div>
          <p className="label text-ink-muted">
            findings, never source · registry cc0 · © 2026
          </p>
        </div>
      </footer>
    </div>
  );
}
