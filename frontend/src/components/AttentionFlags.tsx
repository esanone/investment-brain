/** Small "not priced" / "crowded" chips shared by the attention page, the lists and the detail pages. */
export function AttentionFlags({ notPriced, crowded, empty = false }: { notPriced?: boolean; crowded?: boolean; empty?: boolean }) {
  if (!notPriced && !crowded) return empty ? <span className="text-subtle">—</span> : null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {notPriced && (
        <span className="chip border-accent bg-accent-soft text-accent" title="Attention rising from a low base while pricing is still low">
          not priced
        </span>
      )}
      {crowded && (
        <span className="chip border-neg bg-neg-soft text-neg" title="Extreme attention with extreme price momentum">
          crowded
        </span>
      )}
    </span>
  );
}
