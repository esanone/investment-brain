/**
 * Stands in for the run / generate / analyze buttons in the static export,
 * where there is no backend to kick a job on: the snapshot is refreshed by the
 * scheduled morning job and redeployed.
 */
export function StaticRunNote({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11.5px] text-subtle ${className}`} title="This is a static export of the latest snapshot">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--border-strong)]" />
      Static snapshot: runs happen on the scheduled morning job
    </span>
  );
}
