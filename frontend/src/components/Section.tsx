/** Titled card. Dense padding; title rendered as an uppercase eyebrow. */
export function Section({
  title,
  subtitle,
  actions,
  children,
  className = "",
  flush = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Remove inner padding so tables can run edge to edge. */
  flush?: boolean;
}) {
  // min-w-0: as a grid/flex item the card must be allowed to shrink below its content's
  // min-content width, otherwise one nowrap table widens the whole column (and the page) on phones.
  return (
    <section className={`min-w-0 rounded-md border border-line bg-surface ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="eyebrow">{title}</h2>
          {subtitle && <div className="mt-0.5 text-[12px] text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className={flush ? "" : "px-4 py-3"}>{children}</div>
    </section>
  );
}
