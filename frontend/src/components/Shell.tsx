"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TickerSearch } from "@/components/TickerSearch";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/brief", label: "Brief" },
  { href: "/thesis", label: "Thesis" },
  { href: "/thesis-v2", label: "Human Futures Engine" },
  { href: "/attention", label: "Attention" },
  { href: "/events", label: "Events" },
  { href: "/regime", label: "Regime" },
  { href: "/flows", label: "Flows" },
  { href: "/themes", label: "Themes" },
  { href: "/companies", label: "Companies" },
  { href: "/portfolio", label: "Valuation-Trend Portfolio" },
  { href: "/thesis-book", label: "Thesis-Driven Portfolio" },
  { href: "/etf-book", label: "ETF Book" },
  { href: "/income-book", label: "Income Portfolio" },
  { href: "/risk", label: "Risk" },
  { href: "/hindcast", label: "Hindcast" },
];

/** Routes that belong to a nav entry without living under its path (the static export's `/company/?t=` page). */
const ALIASES: Record<string, string> = { "/companies": "/company" };

/** Match on a whole path segment so "/thesis" does not light up for "/thesis-v2". */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  const alias = ALIASES[href];
  return alias ? isActive(pathname, alias) : false;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-48 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <Link href="/" className="flex items-center gap-2 px-4 py-4">
          <span className="grid size-6 place-items-center rounded bg-accent text-[12px] font-bold text-white">
            II
          </span>
          <span className="text-[13px] font-semibold tracking-tight">Intelligence Engine</span>
        </Link>
        <div className="px-2 pb-2">
          <TickerSearch />
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                  active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-4 py-3 text-[11px] text-subtle">
          Phase 1 · regime, flows, fundamentals, themes
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top nav (mobile) */}
        <header className="sticky top-0 z-30 border-b border-line bg-surface md:hidden">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="grid size-5 place-items-center rounded bg-accent text-[11px] font-bold text-white">
              II
            </span>
            <span className="text-[13px] font-semibold">Intelligence Engine</span>
            <TickerSearch className="ml-auto w-44" align="right" />
          </div>
          <nav className="flex gap-0.5 overflow-x-auto px-2 pb-1.5">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 rounded px-2.5 py-1 text-xs ${
                    active ? "bg-surface-2 font-medium text-ink" : "text-muted"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
