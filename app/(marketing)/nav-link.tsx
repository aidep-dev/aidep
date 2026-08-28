"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A header link that marks the page it is on, for the eye and for assistive tech. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const current = usePathname() === href;
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={current ? "text-ink" : "hover:text-ink"}>
      {children}
    </Link>
  );
}
