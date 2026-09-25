"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API_BASE, api } from "@/lib/api";
import type { Health } from "@/lib/types";

type Phase = "idle" | "starting" | "running" | "error";

/**
 * POSTs /api/attention/run, then polls /api/health until `running_attention` is
 * false and refreshes the server components so the new snapshot shows up. Same
 * shape as BriefRunButton, kept separate so the jobs can run side by side.
 */
export function AttentionRunButton({ initialRunning = false }: { initialRunning?: boolean }) {
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
        if (!h.running_attention) {
          setPhase("idle");
          router.refresh();
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
        return;
      }
      timer.current = setTimeout(poll, 3000);
    };
    timer.current = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, router]);

  async function start() {
    setError(null);
    setPhase("starting");
    const res = await api.runAttention();
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
    <div className="flex items-center gap-2">
      {phase === "error" && error && (
        <span className="max-w-64 truncate text-[11.5px] text-neg" title={error}>
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-surface-2 disabled:cursor-progress disabled:opacity-60"
      >
        {busy && <span className="size-2 animate-pulse rounded-full bg-accent" />}
        {phase === "starting" ? "Starting…" : phase === "running" ? "Refreshing attention…" : "Refresh attention"}
      </button>
    </div>
  );
}
