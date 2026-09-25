import Link from "next/link";
import type { CompanyRow } from "@/lib/types";
import { signed, signClass } from "@/lib/format";
import { ScoreBadge } from "./ScoreBadge";

/** Compact, non-interactive company table used on the dashboard. */
export function CompanyRowsTable({ rows, showRank = true }: { rows: CompanyRow[]; showRank?: boolean }) {
  if (!rows.length) return <div className="px-4 py-3 text-[12.5px] text-muted">No companies in this snapshot.</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {showRank && <th className="num w-8">#</th>}
            <th>Company</th>
            <th className="num">Quality</th>
            <th className="num">Growth</th>
            <th className="num">Value</th>
            <th className="num">Theme</th>
            <th className="num">Flow</th>
            <th className="num">Total</th>
            <th className="num">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.ticker}>
              {showRank && <td className="num text-subtle">{i + 1}</td>}
              <td>
                <Link href={`/companies/${c.ticker}`} className="flex items-baseline gap-2">
                  <span className="font-medium">{c.ticker}</span>
                  <span className="max-w-56 truncate text-muted">{c.name}</span>
                </Link>
              </td>
              <td className="num"><ScoreBadge value={c.quality} /></td>
              <td className="num"><ScoreBadge value={c.growth} /></td>
              <td className="num"><ScoreBadge value={c.value} /></td>
              <td className="num"><ScoreBadge value={c.theme} /></td>
              <td className="num"><ScoreBadge value={c.flow} /></td>
              <td className="num font-semibold">{c.total === null ? "—" : Math.round(c.total)}</td>
              <td className={`num ${signClass(c.expectations_gap)}`}>{signed(c.expectations_gap, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
