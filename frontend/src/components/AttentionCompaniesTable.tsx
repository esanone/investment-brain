"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CompanyAttention, Num } from "@/lib/types";
import { num, pct, ptsSigned, signed, signClass } from "@/lib/format";
import { AttentionFlags } from "./AttentionFlags";
import { ScoreBadge } from "./ScoreBadge";

type NumericKey =
  | "attention"
  | "breadth"
  | "wiki_7d"
  | "wiki_vs_28d_pct"
  | "wiki_vs_1y_pct"
  | "st_watchers"
  | "st_msgs_per_day"
  | "st_bullish_share"
  | "pricing"
  | "price_momentum"
  | "opportunity"
  | "gap";
type StrKey = "ticker" | "name" | "sector";
type SortKey = NumericKey | StrKey | "flags";

interface Col {
  key: SortKey;
  label: string;
  numeric: boolean;
  render: (c: CompanyAttention) => React.ReactNode;
}

const COLS: Col[] = [
  {
    key: "ticker",
    label: "Ticker",
    numeric: false,
    render: (c) => (
      <Link href={`/companies/${c.ticker}`} className="mono font-medium">
        {c.ticker}
      </Link>
    ),
  },
  {
    key: "name",
    label: "Name",
    numeric: false,
    render: (c) => (
      <Link href={`/companies/${c.ticker}`} className="block max-w-48 truncate text-muted">
        {c.name}
      </Link>
    ),
  },
  { key: "sector", label: "Sector", numeric: false, render: (c) => <span className="text-muted">{c.sector}</span> },
  { key: "attention", label: "Attention", numeric: true, render: (c) => <ScoreBadge value={c.attention} /> },
  { key: "breadth", label: "Breadth", numeric: true, render: (c) => <span className="text-muted">{c.breadth}</span> },
  { key: "wiki_7d", label: "Wiki 7d", numeric: true, render: (c) => num(c.wiki_7d, 0) },
  {
    key: "wiki_vs_28d_pct",
    label: "vs 28d",
    numeric: true,
    render: (c) => <span className={signClass(c.wiki_vs_28d_pct)}>{ptsSigned(c.wiki_vs_28d_pct, 0)}</span>,
  },
  {
    key: "wiki_vs_1y_pct",
    label: "vs 1y",
    numeric: true,
    render: (c) => <span className={signClass(c.wiki_vs_1y_pct)}>{ptsSigned(c.wiki_vs_1y_pct, 0)}</span>,
  },
  { key: "st_watchers", label: "ST watchers", numeric: true, render: (c) => num(c.st_watchers, 0) },
  { key: "st_msgs_per_day", label: "ST msgs/day", numeric: true, render: (c) => num(c.st_msgs_per_day, 1) },
  { key: "st_bullish_share", label: "Bullish share", numeric: true, render: (c) => pct(c.st_bullish_share, 0) },
  { key: "pricing", label: "Pricing", numeric: true, render: (c) => <ScoreBadge value={c.pricing} /> },
  { key: "price_momentum", label: "Momentum", numeric: true, render: (c) => <ScoreBadge value={c.price_momentum} /> },
  { key: "opportunity", label: "Opportunity", numeric: true, render: (c) => <span className="font-medium">{num(c.opportunity, 0)}</span> },
  { key: "gap", label: "Gap", numeric: true, render: (c) => <span className={signClass(c.gap)}>{signed(c.gap, 0)}</span> },
  { key: "flags", label: "Flags", numeric: false, render: (c) => <AttentionFlags notPriced={c.not_priced} crowded={c.crowded} /> },
];

function cmpNum(a: Num, b: Num, dir: 1 | -1): number {
  const an = a === null || !Number.isFinite(a);
  const bn = b === null || !Number.isFinite(b);
  if (an && bn) return 0;
  if (an) return 1; // nulls always last
  if (bn) return -1;
  return ((a as number) - (b as number)) * dir;
}

function cmpStr(a: string | null, b: string | null, dir: 1 | -1): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b) * dir;
}

/** Flags sort: crowded > not priced > none. */
function flagRank(c: CompanyAttention): number {
  return (c.crowded ? 2 : 0) + (c.not_priced ? 1 : 0);
}

export function AttentionCompaniesTable({ rows }: { rows: CompanyAttention[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("attention");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [sector, setSector] = useState<string>("");

  const sectors = useMemo(() => Array.from(new Set(rows.map((r) => r.sector).filter(Boolean))).sort(), [rows]);

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sortKey);
    const filtered = sector ? rows.filter((r) => r.sector === sector) : rows;
    const out = [...filtered];
    out.sort((a, b) => {
      if (sortKey === "flags") return (flagRank(a) - flagRank(b)) * dir;
      if (col?.numeric) return cmpNum(a[sortKey as NumericKey], b[sortKey as NumericKey], dir);
      return cmpStr(a[sortKey as StrKey], b[sortKey as StrKey], dir);
    });
    return out;
  }, [rows, sortKey, dir, sector]);

  function clickHeader(col: Col) {
    if (col.key === sortKey) {
      setDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(col.key);
      setDir(col.numeric || col.key === "flags" ? -1 : 1);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 text-[12.5px]">
        <label className="flex items-center gap-2 text-muted">
          Sector
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded border border-line bg-surface px-2 py-1 text-[12.5px] text-ink"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span className="text-subtle">
          {sorted.length} of {rows.length} companies · sorted by {COLS.find((c) => c.key === sortKey)?.label}{" "}
          {dir === -1 ? "↓" : "↑"}
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  className={`sortable ${col.numeric ? "num" : ""} ${col.key === sortKey ? "sorted" : ""}`}
                  onClick={() => clickHeader(col)}
                  aria-sort={col.key === sortKey ? (dir === 1 ? "ascending" : "descending") : "none"}
                >
                  {col.label}
                  {col.key === sortKey && <span className="ml-1 text-subtle">{dir === -1 ? "↓" : "↑"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.ticker}>
                {COLS.map((col) => (
                  <td key={col.key} className={col.numeric ? "num" : ""}>
                    {col.render(c)}
                  </td>
                ))}
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={COLS.length} className="py-6 text-center text-muted">
                  No companies match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
