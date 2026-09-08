import Link from "next/link";
import { Wordmark } from "../mark.tsx";
import { ThemeToggle } from "../theme.tsx";
import { AuthNotice } from "./auth-notice.tsx";
import { NavLink } from "./nav-link.tsx";
import { installUrl } from "./site.ts";

/* The header carries the product and the trust. Everything else is in the footer. */
const NAV = [
  { href: "/dead", label: "register" },
  { href: "/security", label: "security" },
];
const FOOTER_NAV = [
  ...NAV,
  { href: "/handbook", label: "handbook" },
  { href: "/roadmap", label: "roadmap" },
  { href: "/pricing", label: "pricing" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-field flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <Link href="/" className="text-xl text-ink">
            <Wordmark />
          </Link>

          <nav className="label hidden items-center gap-7 text-ink-secondary md:flex">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <a href={installUrl()} className="btn btn-outline px-3 py-1.5">
            install
          </a>
        </div>
      </header>

      <AuthNotice />
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
