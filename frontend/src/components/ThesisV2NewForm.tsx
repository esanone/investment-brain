"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API_BASE, api } from "@/lib/api";
import { IS_STATIC } from "@/lib/static";
import type { Health } from "@/lib/types";
import { StaticRunNote } from "@/components/StaticRunNote";

type Phase = "idle" | "starting" | "running" | "error";

const MIN_CHARS = 20;
const PLACEHOLDER = "e.g. By 2030 a majority of US households will let an AI agent make routine purchases on their behalf.";

/**
 * Textarea + button that POSTs /api/thesis-v2 {statement}, then polls
 * /api/health until `running_thesis_v2` is false and refreshes the server
 * components so the new ledger row shows up. Same shape as BriefRunButton.
 * In the static export there is nothing to run, so a muted note renders instead.
 */
export function ThesisV2NewForm(props: { initialRunning?: boolean }) {
  if (IS_STATIC) return <StaticThesisV2NewForm />;
  return <LiveThesisV2NewForm {...props} />;
}

function StaticThesisV2NewForm() {
  return (
    <div className="flex flex-col gap-2 text-[12.5px] text-muted">
      <p>
        New theses are analysed on the live backend: <span className="mono">POST /api/thesis-v2</span> with a statement, or
      </p>
      <pre className="mono overflow-x-auto rounded border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-6">
        {"cd backend && .venv/bin/python -m brain.pipeline thesis-v2 --seed"}
      </pre>
      <StaticRunNote />
    </div>
  );
}

function LiveThesisV2NewForm({ initialRunning = false }: { initialRunning?: boolean }) {
  const router = useRouter();
  const [statement, setStatement] = useState("");
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
            setStatement("");
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

  async function start() {
    const text = statement.trim();
    if (text.length < MIN_CHARS) return;
    setError(null);
    setPhase("starting");
    const res = await api.createThesisV2(text);
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
  const tooShort = statement.trim().length < MIN_CHARS;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <label htmlFor="thesis-v2-statement" className="text-[12.5px] text-muted">
        State the thesis as one full sentence: who (population), does what (behaviour), by when (horizon).
      </label>
      <textarea
        id="thesis-v2-statement"
        value={statement}
        onChange={(e) => setStatement(e.target.value)}
        disabled={busy}
        rows={3}
        placeholder={PLACEHOLDER}
        className="w-full resize-y rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] leading-relaxed placeholder:text-subtle disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="submit"
          disabled={busy || tooShort}
          className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
          style={busy ? { cursor: "progress" } : undefined}
        >
          {busy && <span className="size-2 animate-pulse rounded-full bg-accent" />}
          {phase === "starting" ? "Starting…" : phase === "running" ? "Analysing…" : "Analyse thesis"}
        </button>
        {phase === "running" && (
          <span className="text-[12px] text-muted">Formalising, retrieving analogues, weighing evidence… ~4 min</span>
        )}
        {phase === "idle" && tooShort && statement.length > 0 && (
          <span className="text-[11.5px] text-subtle">
            {MIN_CHARS - statement.trim().length} more character{MIN_CHARS - statement.trim().length === 1 ? "" : "s"}
          </span>
        )}
        {phase === "error" && error && (
          <span className="min-w-0 max-w-full truncate text-[11.5px] text-neg" title={error}>
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
