/**
 * Empty state for a page whose snapshot is produced by one specific command
 * (ETF book, hindcast): says what is missing and the CLI line that builds it.
 */
export function CommandEmptyState({ title, children, command, message }: { title: string; children?: React.ReactNode; command: string; message?: string }) {
  return (
    <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children && <p className="mt-1 text-[13px] text-muted">{children}</p>}
      <pre className="mono mt-3 overflow-x-auto rounded border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-6">{command}</pre>
      {message && (
        <p className="mt-3 text-[11.5px] text-subtle">
          Last request: <span className="mono">{message}</span>
        </p>
      )}
    </div>
  );
}
