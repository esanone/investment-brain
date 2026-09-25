"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SearchResult } from "@/lib/types";

type Status = "idle" | "loading" | "ready" | "unavailable";

/** Anything that looks like a bare ticker: lets Enter fall through to /companies/X even when search is down. */
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,7}$/;

/**
 * Debounced ticker/name search against /api/search. Lives in the Shell so it is
 * on every page; "/" focuses it, arrows + Enter pick a row, Escape closes.
 * Registry-only names (not in the scored universe) are tagged so the user knows
 * the company page will offer on-demand analysis instead of a snapshot.
 */
export function TickerSearch({ className = "", align = "left" }: { className?: string; align?: "left" | "right" }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const listId = useId();

  // "/" focuses the box from anywhere on the page (unless the user is already typing somewhere).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const el = inputRef.current;
      // The Shell renders one copy for the sidebar and one for the mobile header; only the visible one reacts.
      if (!el || el.offsetParent === null) return;
      e.preventDefault();
      el.focus();
      el.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close when clicking anywhere else.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Debounced fetch. A sequence number drops late responses from superseded queries
  // (state resets for an emptied box happen in `setQuery`, not here).
  useEffect(() => {
    const id = ++seq.current;
    const text = q.trim();
    if (!text) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const res = await api.search(text, 12, ctrl.signal);
      if (id !== seq.current) return;
      if (res.ok) {
        setResults(res.data);
        setStatus("ready");
        setActive(0);
      } else {
        setResults([]);
        setStatus(res.status === null ? "unavailable" : "ready");
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  const setQuery = useCallback((value: string) => {
    setQ(value);
    if (value.trim()) {
      setStatus("loading");
    } else {
      setResults([]);
      setStatus("idle");
    }
  }, []);

  const go = useCallback(
    (ticker: string) => {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
      router.push(`/companies/${encodeURIComponent(ticker.toUpperCase())}`);
    },
    [router, setQuery],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % results.length : (i - 1 + results.length) % results.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) {
        go(hit.ticker);
        return;
      }
      // No rows (or search down): a bare ticker still routes to its page, which offers on-demand analysis.
      const typed = q.trim().toUpperCase();
      if (status !== "loading" && TICKER_RE.test(typed)) go(typed);
    }
  }

  const showList = open && q.trim().length > 0;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="flex items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-1 transition-colors focus-within:border-accent">
        <span aria-hidden className="text-[12px] leading-none text-subtle">
          ⌕
        </span>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Ticker or name"
          role="combobox"
          aria-label="Search tickers"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          autoComplete="off"
          spellCheck={false}
          className="mono min-w-0 flex-1 bg-transparent text-[12.5px] uppercase outline-none placeholder:normal-case placeholder:text-subtle"
        />
        {status === "loading" ? (
          <span aria-label="Searching" className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
        ) : (
          <kbd className="rounded border border-line px-1 text-[10px] leading-4 text-subtle">/</kbd>
        )}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className={`absolute top-full z-40 mt-1 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded border border-line bg-surface shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {results.map((r, i) => {
            const tags = !r.in_universe || r.foreign_filer;
            return (
              <li
                key={r.ticker}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(r.ticker);
                }}
                className={`cursor-pointer px-2.5 py-1.5 text-[12.5px] ${i === active ? "bg-surface-2" : ""}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="mono w-14 shrink-0 font-semibold">{r.ticker}</span>
                  <span className={`min-w-0 flex-1 truncate ${r.in_universe ? "" : "text-muted"}`}>{r.name}</span>
                  {r.sector && <span className="chip shrink-0">{r.sector}</span>}
                </div>
                {tags && (
                  <div className="mt-0.5 flex gap-2 pl-16 text-[10.5px] text-subtle">
                    {!r.in_universe && <span>not in universe · analyze on demand</span>}
                    {r.foreign_filer && <span className="text-warn">foreign filer</span>}
                  </div>
                )}
              </li>
            );
          })}
          {!results.length && (
            <li className="px-2.5 py-2 text-[12px] text-muted">
              {status === "loading" ? "Searching…" : status === "unavailable" ? "Search unavailable — API not reachable" : "No matches"}
            </li>
          )}
          {results.length > 0 && (
            <li className="border-t border-line px-2.5 py-1 text-[10.5px] text-subtle">↑↓ to move · Enter to open · Esc to close</li>
          )}
        </ul>
      )}
    </div>
  );
}
