import type { InsiderTx } from "@/lib/types";
import { date, money, num, price } from "@/lib/format";

/**
 * Compact list of Form 4 transactions (date / owner / title / shares / price / value / filing link).
 * Shared by the events page (insider buying, heavy selling) and the company page.
 */
export function InsiderTxTable({ rows, empty = "No transactions." }: { rows: InsiderTx[] | null | undefined; empty?: string }) {
  const list = rows ?? [];
  if (!list.length) return <div className="px-4 py-2 text-[12.5px] text-muted">{empty}</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Date</th>
            <th>Owner</th>
            <th>Title</th>
            <th className="num">Shares</th>
            <th className="num">Price</th>
            <th className="num">Value</th>
            <th>Filing</th>
          </tr>
        </thead>
        <tbody>
          {list.map((t, i) => (
            <tr key={`${t.date}-${t.owner}-${i}`}>
              <td className="mono whitespace-nowrap">{date(t.date)}</td>
              <td className="max-w-56 truncate">{t.owner || "—"}</td>
              <td className="max-w-48 truncate text-muted">{t.title || "—"}</td>
              <td className="num">{num(t.shares, 0)}</td>
              <td className="num">{price(t.price)}</td>
              <td className="num font-medium">{money(t.value, 0)}</td>
              <td>
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Form 4
                  </a>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
