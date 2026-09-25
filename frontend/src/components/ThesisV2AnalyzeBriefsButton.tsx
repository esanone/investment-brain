"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API_BASE, api } from "@/lib/api";
import { IS_STATIC } from "@/lib/static";
import type { Health } from "@/lib/types";
import { StaticRunNote } from "@/components/StaticRunNote";

type Phase = "idle" | "starting" | "running" | "error";

/**
 * POSTs /api/thesis-v2/analyze-briefs (consolidate the briefs' long-term
 * human-behaviour bullets into theses, analyse each new one, re-rank stocks;
 * 15-25 min), then polls /api/health until `running_thesis_v2` is false and
 * refreshes the server components so the new ranking shows up. Same shape as
 * ThesisV2Actions. In the static export there is nothing to run, so a muted
 * note renders instead.
 */
export function ThesisV2AnalyzeBriefsButton(props: { initialRunning?: boolean }) {
  if (IS_STATIC) return <StaticRunNote />;
  return <LiveAnalyzeBriefsButton {...props} />;
}

function LiveAnalyzeBriefsButton({ initialRunning = false }: { initialRunning?: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initialRunning ? "running" : "idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
        const h = (await res.json()) as Health;
        if (cancelled) return;
        if (!h.running_thesis_v2) {
          if (h.last_error) {
            setError(h.last_error);
            setPhase("error");
          } else {
            setPhase("idle");
          }
          router.refresh();
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
        return;
      }
      timer.current = setTimeout(poll, 6000);
    };
    timer.current = setTimeout(poll, 4000);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, router]);

  async function start() {
    setError(null);
    setPhase("starting");
    const res = await api.analyzeBriefsThesisV2();
    if (!res.ok) {
      setError(res.message);
      setPhase("error");
      return;
    }
    // "already running" is fine: just attach to the running job.
    if (!res.data.started && res.data.reason && res.data.reason !== "already running") {
      setError(res.data.reason);
      setPhase("error");
      return;
    }
    setPhase("running");
  }

  const busy = phase === "starting" || phase === "running";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {phase === "error" && error && (
          <span className="max-w-64 truncate text-[11.5px] text-neg" title={error}>
            {error}
          </span>
        )}
        <button
          type="button"
          onClick={start}
          disabled={busy}
          title="Consolidate the morning briefs' long-term human-behaviour bullets into theses, analyse each new thesis, then re-rank the universe against their value pools (15-25 min)"
          className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
          style={busy ? { cursor: "progress" } : undefined}
        >
          {busy && <span className="size-2 animate-pulse rounded-full bg-accent" />}
          {phase === "starting" ? "Starting…" : phase === "running" ? "Analysing…" : "Analyze brief bullets → theses → stocks"}
        </button>
      </div>
      {phase === "running" && (
        <span className="text-right text-[11.5px] text-muted">Consolidating long-term bullets, analysing each thesis (~20 min)…</span>
      )}
    </div>
  );
}
