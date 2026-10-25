"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PixelIcon } from "./Pieces";

const NAV = [
  { href: "/", label: "Dashboard", icon: "grid" as const },
  { href: "/cases", label: "Case log", icon: "scroll" as const },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="mx-auto flex w-full max-w-[1064px] flex-wrap items-center justify-between gap-4 px-4 py-6">
      <Link href="/" className="flex items-center gap-3 no-underline">
        <Image src="/logo.svg" alt="" width={48} height={48} unoptimized loading="eager" />
        <span className="flex flex-col gap-2">
          <span className="font-display text-[40px] leading-none" style={{ color: "var(--gold)", textShadow: "4px 4px 0 #7a2348" }}>
            Agent Courtroom
          </span>
          <span className="text-sm leading-none text-soft">Runtime oversight for autonomous agents</span>
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
