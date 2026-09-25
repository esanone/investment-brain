"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CompanyRow, Num } from "@/lib/types";
import { money, multiple, pct, price, ptsSigned, signed, signClass } from "@/lib/format";
import { AttentionFlags } from "./AttentionFlags";
import { ScoreBadge } from "./ScoreBadge";

type NumericKey =
  | "price"
  | "market_cap"
  | "quality"
  | "growth"
  | "value"
  | "theme"
  | "flow"
  | "total"
  | "reality"
  | "pricing"
  | "expectations_gap"
  | "revenue_growth"
  | "roic"
  | "fcf_yield"
  | "pe"
  | "ev_sales"
  | "return_3m"
  | "attention";
type SortKey = NumericKey | "ticker" | "sector" | "top_theme";

interface Col {
  key: SortKey;
  label: string;
  numeric: boolean;
  render: (c: CompanyRow) => React.ReactNode;
}

const COLS: Col[] = [
  {
    key: "ticker",
    label: "Company",
    numeric: false,
    render: (c) => (
      <Link href={`/companies/${c.ticker}`} className="flex items-baseline gap-2">
        <span className="font-medium">{c.ticker}</span>
        <span className="max-w-48 truncate text-muted">{c.name}</span>
      </Link>
    ),
  },
  { key: "sector", label: "Sector", numeric: false, render: (c) => <span className="text-muted">{c.sector}</span> },
  { key: "price", label: "Price", numeric: true, render: (c) => price(c.price) },
  { key: "market_cap", label: "Mkt cap", numeric: true, render: (c) => money(c.market_cap) },
  { key: "quality", label: "Quality", numeric: true, render: (c) => <ScoreBadge value={c.quality} /> },
  { key: "growth", label: "Growth", numeric: true, render: (c) => <ScoreBadge value={c.growth} /> },
  { key: "value", label: "Value", numeric: true, render: (c) => <ScoreBadge value={c.value} /> },
  { key: "theme", label: "Theme", numeric: true, render: (c) => <ScoreBadge value={c.theme} /> },
  { key: "flow", label: "Flow", numeric: true, render: (c) => <ScoreBadge value={c.flow} /> },
  {
    key: "total",
    label: "Total",
    numeric: true,
    render: (c) => <span className="font-semibold">{c.total === null ? "—" : Math.round(c.total)}</span>,
  },
  { key: "reality", label: "Reality", numeric: true, render: (c) => <ScoreBadge value={c.reality} /> },
  { key: "pricing", label: "Pricing", numeric: true, render: (c) => <ScoreBadge value={c.pricing} /> },
  {
    key: "expectations_gap",
    label: "Gap",
    numeric: true,
    render: (c) => <span className={signClass(c.expectations_gap)}>{signed(c.expectations_gap, 0)}</span>,
  },
  {
    key: "revenue_growth",
    label: "Rev growth",
    numeric: true,
    render: (c) => <span className={signClass(c.revenue_growth)}>{pct(c.revenue_growth)}</span>,
  },
  { key: "roic", label: "ROIC", numeric: true, render: (c) => pct(c.roic) },
  { key: "fcf_yield", label: "FCF yield", numeric: true, render: (c) => pct(c.fcf_yield) },
  { key: "pe", label: "P/E", numeric: true, render: (c) => multiple(c.pe) },
  { key: "ev_sales", label: "EV/Sales", numeric: true, render: (c) => multiple(c.ev_sales) },
  {
    key: "return_3m",
    label: "3m return",
    numeric: true,
    render: (c) => <span className={signClass(c.return_3m)}>{ptsSigned(c.return_3m)}</span>,
  },
  {
    key: "attention",
    label: "Attention",
    numeric: true,
    render: (c) => (
      <span className="inline-flex items-center gap-1.5">
        <AttentionFlags notPriced={c.not_priced} crowded={c.crowded} />
        <ScoreBadge value={c.attention} />
      </span>
    ),
  },
  {
    key: "top_theme",
    label: "Top theme",
    numeric: false,
    render: (c) => <span className="text-muted">{c.top_theme ?? "—"}</span>,
  },
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

export function CompaniesTable({ rows }: { rows: CompanyRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [sector, setSector] = useState<string>("");

  const sectors = useMemo(() => Array.from(new Set(rows.map((r) => r.sector).filter(Boolean))).sort(), [rows]);

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sortKey);
    const filtered = sector ? rows.filter((r) => r.sector === sector) : rows;
    const out = [...filtered];
    out.sort((a, b) => {
      if (col?.numeric) return cmpNum(a[sortKey as NumericKey] ?? null, b[sortKey as NumericKey] ?? null, dir);
      return cmpStr(a[sortKey as "ticker" | "sector" | "top_theme"], b[sortKey as "ticker" | "sector" | "top_theme"], dir);
    });
    return out;
  }, [rows, sortKey, dir, sector]);

  function clickHeader(col: Col) {
    if (col.key === sortKey) {
      setDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(col.key);
      setDir(col.numeric ? -1 : 1);
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
