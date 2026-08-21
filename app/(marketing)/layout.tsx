import Link from "next/link";
import { ThemeToggle } from "../theme.tsx";

const NAV = [
  { href: "/dead", label: "What is dead" },
  { href: "/handbook", label: "Handbook" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header>
        {/* Utility strip: the thin line of type above a nameplate. */}
        <div className="border-b border-rule">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-1.5 text-[11px] uppercase tracking-widest text-ink-muted">
            <span>Established 2026 · Independent</span>
            <ThemeToggle />
          </div>
        </div>

        {/* Nameplate. Set in the display serif at a size nothing else on the
         * page reaches, which is the whole point of a masthead. */}
        <div className="mx-auto max-w-5xl px-6">
          <div className="flex items-end justify-between gap-6 pb-2 pt-7">
            <Link href="/" className="font-display text-5xl leading-[0.85] tracking-tight text-ink sm:text-6xl">
              aidep
            </Link>
            <p className="hidden max-w-[10rem] pb-1.5 text-right text-[11px] uppercase leading-relaxed tracking-widest text-ink-muted sm:block">
              A register of
              <br />
              dying model APIs
            </p>
          </div>
        </div>

        {/* Folio rule: heavy line, nav, hairline. */}
        <div className="mx-auto max-w-5xl px-6">
          <nav className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y-[3px] border-ink py-2 text-xs uppercase tracking-widest">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="text-ink-secondary hover:text-ink">
                  {item.label}
                </Link>
              ))}
            </div>
            <Link href="/dashboard" className="text-ink hover:text-link">
              Dashboard →
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mx-auto w-full max-w-5xl px-6">
        <div className="mt-16 border-t-[3px] border-ink pt-3 text-xs leading-relaxed text-ink-muted">
          <p className="max-w-2xl">
            aidep tracks model and API deprecations across OpenAI, Anthropic, and Google. We store
            findings, never your source code.
          </p>
          <p className="mt-2">
            <Link href="/handbook" className="text-link underline underline-offset-2">
              Handbook
            </Link>{" "}
            · Registry is public domain (CC0)
          </p>
        </div>
      </footer>
    </>
  );
}
