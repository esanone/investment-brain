"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API_BASE, api } from "@/lib/api";
import { IS_STATIC } from "@/lib/static";
import type { Health, ThesisV2Status } from "@/lib/types";
import { StaticRunNote } from "@/components/StaticRunNote";

type Phase = "idle" | "starting" | "running" | "error";

/**
 * Header controls of one Thesis v2 record: the monthly "what changed?" review
 * (POST /api/thesis-v2/{id}/update, polled through /api/health `running_thesis_v2`)
 * and the resolve control (two buttons with a confirm step; POST .../resolve is
 * synchronous). In the static export there is nothing to run, so a muted note
 * renders instead.
 */
export function ThesisV2Actions(props: { id: string; status: ThesisV2Status | string; initialRunning?: boolean }) {
  if (IS_STATIC) return <StaticRunNote />;
  return <LiveThesisV2Actions {...props} />;
}

const BTN =
  "inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60";
const BTN_SM = "rounded border border-line px-2 py-0.5 text-[11.5px] transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60";

function LiveThesisV2Actions({ id, status, initialRunning = false }: { id: string; status: ThesisV2Status | string; initialRunning?: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initialRunning ? "running" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean | null>(null);
  const [resolving, setResolving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolved = status === "resolved";

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
      timer.current = setTimeout(poll, 4000);
    };
    timer.current = setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, router]);

  async function review() {
    setError(null);
    setPhase("starting");
    const res = await api.updateThesisV2(id);
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

  async function confirmResolve() {
    if (pending === null) return;
    setError(null);
    setResolving(true);
    const res = await api.resolveThesisV2(id, pending);
    setResolving(false);
    if (!res.ok) {
      setError(res.message);
      setPhase("error");
      return;
    }
    setPending(null);
    router.refresh();
  }

  const busy = phase === "starting" || phase === "running";
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {phase === "error" && error && (
          <span className="max-w-64 truncate text-[11.5px] text-neg" title={error}>
            {error}
          </span>
        )}
        <button
          type="button"
          onClick={review}
          disabled={busy || resolved || resolving}
          title={resolved ? "Resolved theses are frozen; no further reviews" : "Re-read recent briefs and attention, add or retire evidence, recompute the posterior (3-5 min)"}
          className={BTN}
          style={busy ? { cursor: "progress" } : undefined}
        >
          {busy && <span className="size-2 animate-pulse rounded-full bg-accent" />}
          {phase === "starting" ? "Starting…" : phase === "running" ? "Reviewing… what changed?" : "Monthly review: what changed?"}
        </button>
      </div>
      {!resolved && pending === null && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-subtle">
          <span>Resolve</span>
          <button type="button" className={`${BTN_SM} text-pos`} disabled={busy || resolving} onClick={() => setPending(true)}>
            Resolved: true
          </button>
          <button type="button" className={`${BTN_SM} text-neg`} disabled={busy || resolving} onClick={() => setPending(false)}>
            Resolved: false
          </button>
        </div>
      )}
      {!resolved && pending !== null && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 rounded border border-warn bg-warn-soft px-2 py-1 text-[11.5px] text-warn">
          <span>
            Mark <span className="mono">{id}</span> resolved as <span className="font-semibold">{String(pending)}</span>? This freezes the record and Brier-scores it.
          </span>
          <button type="button" className={`${BTN_SM} border-warn font-medium`} disabled={resolving} onClick={confirmResolve}>
            {resolving ? "Resolving…" : "Confirm"}
          </button>
          <button type="button" className={BTN_SM} disabled={resolving} onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      {busy && <span className="text-[11.5px] text-muted">Re-weighing evidence… ~4 min</span>}
    </div>
  );
}
