import { API_BASE } from "@/lib/api";

/**
 * Shown whenever the API is unreachable or has no snapshot yet. Gives the two
 * commands that bring the backend up.
 */
export function EmptyState({ message, title = "No data yet" }: { message?: string; title?: string }) {
  return (
    <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 text-[13px] text-muted">
        The frontend reads from the FastAPI backend at <span className="mono">{API_BASE}</span>.
        {message && (
          <>
            {" "}
            The last request returned: <span className="mono text-neg">{message}</span>
          </>
        )}
      </p>
      <p className="mt-4 text-[13px]">Produce a snapshot and start the API from the repository root:</p>
      <pre className="mono mt-2 overflow-x-auto rounded border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-6">
        {"cd backend && .venv/bin/python -m brain.pipeline run\n"}
        {"cd backend && .venv/bin/uvicorn brain.api:app --port 8000"}
      </pre>
      <p className="mt-3 text-[12px] text-subtle">
        Set <span className="mono">NEXT_PUBLIC_API_URL</span> in <span className="mono">.env.local</span> if the API runs elsewhere.
      </p>
    </div>
  );
}
