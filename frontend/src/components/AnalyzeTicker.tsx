"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

type Phase = "idle" | "running" | "done" | "error";

/**
 * Shown on /companies/[ticker] when the API answers 404 (ticker not in the
 * current run). POSTs /api/companies/{ticker}/analyze, then refreshes the server
 * component so the freshly scored payload renders in place. 422/500 reasons
 * (pre-revenue, foreign filer, …) are shown inline.
 */
export function AnalyzeTicker({ ticker, message }: { ticker: string; message?: string }) {
  const router = useRouter();
  const t = ticker.toUpperCase();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setError(null);
    setPhase("running");
    const res = await api.analyze(t);
    if (res.ok) {
      setPhase("done");
      router.refresh();
    } else {
      setError(res.message);
      setPhase("error");
    }
  }

  const busy = phase === "running" || phase === "done";

  return (
    <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
      <h2 className="text-[15px] font-semibold">
        <span className="mono text-[15px]">{t}</span> is not in the current run
      </h2>
      <p className="mt-1 text-[13px] text-muted">
        The weekly pipeline only scores the configured universe. Any SEC-registered filer can be pulled in on demand: the
        engines fetch its filings and prices, score it against the current run, and keep it in every future run.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={analyze}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-surface-2 disabled:cursor-progress disabled:opacity-60"
        >
          {busy && <span className="size-2 animate-pulse rounded-full bg-accent" />}
          {phase === "running" ? "Analyzing…" : phase === "done" ? "Loading snapshot…" : `Analyze ${t} on demand`}
        </button>
        {phase === "running" && (
          <span className="text-[12px] text-muted">Pulling SEC filings and prices, scoring against the universe… ~10 s</span>
        )}
      </div>

      {phase === "error" && error && (
        <div className="mt-3">
          <div className="text-[13px] text-neg">{error}</div>
          <div className="mt-1 text-[12px] text-subtle">
            Try another ticker — press <kbd className="rounded border border-line px-1 text-[10px]">/</kbd> to search, or{" "}
            <Link href="/companies" className="hover:text-accent">
              browse the universe
            </Link>
            .
          </div>
        </div>
      )}

      {message && (
        <p className="mt-4 text-[11.5px] text-subtle">
          API: <span className="mono">{message}</span>
        </p>
      )}
    </div>
  );
}
