"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { IS_STATIC, fetchStaticJson, type StaticResult } from "@/lib/static";
import type { CompanyDetail, RunRow } from "@/lib/types";
import { date } from "@/lib/format";
import { AnalyzeTicker } from "@/components/AnalyzeTicker";
import { CompanyView } from "@/components/CompanyView";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

/** `key` = the ticker the response belongs to, so a late response never renders under another ticker. */
type Loaded = { key: string; res: StaticResult<CompanyDetail>; runAsOf: string | null };

/** Same shape the live route accepts; anything else is treated as "no ticker". */
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

const noopSubscribe = () => () => {};

/**
 * Static export's company page (`/company/?t=NVDA`): reads the ticker from the
 * query string, fetches `/data/api/companies/<TICKER>.json` in the browser and
 * hands it to the same `CompanyView` the live server page renders. One exported
 * page serves the whole universe, so the export does not grow with it.
 * In live mode the route only forwards to `/companies/<TICKER>`.
 */
export function CompanyClientPage() {
  const router = useRouter();
  const params = useSearchParams();
  // The prerendered HTML has no query string (force-static renders with empty search params), so the first
  // client render must match it: stay on the loading header until hydration is done, then read `?t=`.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const raw = (params.get("t") ?? "").trim().toUpperCase();
  const ticker = TICKER_RE.test(raw) ? raw : "";
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!IS_STATIC) router.replace(ticker ? `/companies/${encodeURIComponent(ticker)}` : "/companies");
  }, [router, ticker]);

  useEffect(() => {
    if (!IS_STATIC || !ticker) return;
    const ctrl = new AbortController();
    (async () => {
      const res = await fetchStaticJson<CompanyDetail>(`/api/companies/${encodeURIComponent(ticker)}`, ctrl.signal);
      let runAsOf: string | null = null;
      if (res.ok && res.data.on_demand) {
        // On-demand rows are scored against the latest run's universe; show which one.
        const runs = await fetchStaticJson<RunRow[]>("/api/runs", ctrl.signal);
        runAsOf = runs.ok && runs.data[0] ? date(runs.data[0].as_of) : null;
      }
      if (!ctrl.signal.aborted) setLoaded({ key: ticker, res, runAsOf });
    })();
    return () => ctrl.abort();
  }, [ticker]);

  useEffect(() => {
    if (IS_STATIC && ticker) document.title = `${ticker} · IIE`;
  }, [ticker]);

  if (!hydrated) return <PageHeader title="Company" subtitle="Loading the snapshot…" />;
  if (!IS_STATIC) return <PageHeader title={ticker || "Company"} subtitle="Opening the company page…" />;

  if (!ticker) {
    return (
      <>
        <PageHeader title="Company" />
        <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
          <h2 className="text-[15px] font-semibold">No ticker selected</h2>
          <p className="mt-1 text-[13px] text-muted">
            Press <kbd className="rounded border border-line px-1 text-[10px]">/</kbd> to search, or{" "}
            <Link href="/companies" className="text-accent hover:underline">
              browse the universe
            </Link>
            .
          </p>
        </div>
      </>
    );
  }

  const current = loaded && loaded.key === ticker ? loaded : null;
  if (!current) return <PageHeader title={ticker} subtitle="Loading the snapshot…" />;

  const { res, runAsOf } = current;
  if (!res.ok) {
    return (
      <>
        <PageHeader title={ticker} />
        {res.status === 404 ? <AnalyzeTicker ticker={ticker} message={res.message} /> : <EmptyState message={res.message} />}
      </>
    );
  }
  return <CompanyView data={res.data} runAsOf={runAsOf} />;
}
