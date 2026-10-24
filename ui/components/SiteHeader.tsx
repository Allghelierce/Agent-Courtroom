"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PixelIcon } from "./Pieces";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/cases", label: "Cases" },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-4 px-4 py-5">
      <Link href="/" className="flex items-center gap-3 no-underline">
        <span className="grid size-8 place-items-center rounded-md" style={{ background: "var(--gold)", color: "var(--on-accent)" }}>
          <PixelIcon name="gavel" size={16} />
        </span>
        <span className="flex flex-col">
          <span className="text-[16px] font-semibold leading-tight">Agent Courtroom</span>
          <span className="text-[12px] leading-tight text-c-soft">Runtime oversight for autonomous agents</span>
        </span>
      </Link>
      <nav className="flex gap-1" aria-label="Main">
        {NAV.map(({ href, label }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href) || (href === "/cases" && path.startsWith("/court"));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="rounded-md px-3 py-2 text-[13px] font-medium no-underline"
              style={{ background: active ? "var(--c-raise)" : undefined, color: active ? "var(--c-text)" : "var(--c-soft)" }}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
