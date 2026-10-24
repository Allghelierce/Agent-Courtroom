"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Chibi } from "./Sprites";
import { PixelIcon } from "./Pieces";

const NAV = [
  { href: "/", label: "Dashboard", icon: "grid" as const },
  { href: "/cases", label: "Case log", icon: "scroll" as const },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-6">
      <Link href="/" className="flex items-center gap-3 no-underline">
        <Chibi who="judge" mood="happy" scale={2} />
        <span className="font-display text-[28px] leading-none" style={{ textShadow: "4px 4px 0 var(--paper)" }}>
          Agent Courtroom
        </span>
      </Link>
      <nav className="flex gap-3" aria-label="Main">
        {NAV.map(({ href, label, icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href) || (href === "/cases" && path.startsWith("/court"));
          return (
            <Link key={href} href={href} className={`px-btn ${active ? "" : "ghost"}`} aria-current={active ? "page" : undefined}>
              <PixelIcon name={icon} />
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
