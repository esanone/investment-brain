"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import type { Num, ThesisBookCandidate, ThesisBookComponents, ThesisBookDriver, ThesisBookHolding, ThesisBookTechnical, ThesisBookValuation } from "@/lib/types";
import { companyHref, date, money, num, pct, price, pts, ptsSigned, signClass } from "@/lib/format";
import { ScoreBadge } from "@/components/ScoreBadge";
import { ThesisRefChip } from "@/components/ThesisV2Chips";

/** Tables of the thesis-driven portfolio page: holdings (expandable rows) and the favoured-but-not-held candidates (status filter). */

const COMPONENTS: { key: keyof ThesisBookComponents; label: string; short: string }[] = [
  { key: "ledger", label: "Ledger", short: "L" },
  { key: "structural", label: "Structural", short: "S" },
  { key: "brief", label: "Brief", short: "B" },
];

const KIND_LABELS: Record<string, string> = { ledger: "Ledger", structural: "Structural", brief: "Brief" };

const POSITION_LABELS: Record<string, string> = {
  below_base: "below base",
  base_to_bull: "base → bull",
  above_bull: "above bull",
  no_model: "no model",
};

const POSITION_CLASS: Record<string, string> = {
  below_base: "border-pos bg-pos-soft text-pos",
  base_to_bull: "border-warn bg-warn-soft text-warn",
  above_bull: "border-neg bg-neg-soft text-neg",
  no_model: "border-dashed text-subtle",
};

const POSITION_TITLES: Record<string, string> = {
  below_base: "Price is below the base fair-value scenario",
  base_to_bull: "Price is between the base and bull scenarios: the thesis has to be right for this to work",
  above_bull: "Price is above the bull scenario: excluded from the book",
  no_model: "No fair-value model for this name; the bull ceiling could not be checked",
};

/** Candidate statuses in funnel order; `selected` rows are the holdings and are not listed here. */
const STATUS_ORDER = ["above_bull", "market_gate", "sector_gate", "trend_gate", "earnings", "caps", "passed"];

const STATUS_LABELS: Record<string, string> = {
  above_bull: "Above bull",
  market_gate: "Market gate",
  sector_gate: "Sector gate",
  trend_gate: "Trend gate",
  earnings: "Earnings",
  caps: "Caps",
  passed: "Passed gates",
};

const STATUS_CLASS: Record<string, string> = {
  above_bull: "border-neg bg-neg-soft text-neg",
  market_gate: "border-warn bg-warn-soft text-warn",
  sector_gate: "border-warn bg-warn-soft text-warn",
  trend_gate: "border-warn bg-warn-soft text-warn",
};

function has(v: Num | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return map[key] ?? key.replace(/_/g, " ");
}

/** The three source scores as "L 62 S 80 B 40" (each 0-100). */
function ComponentsCell({ c }: { c: ThesisBookComponents | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-2">
      {COMPONENTS.map(({ key, label: l, short }) => {
        const v = c?.[key];
        return (
          <span key={key} className="inline-flex items-baseline gap-1" title={`${l} ${has(v) ? num(v, 0) : "not measured"}`}>
            <span className="text-[10.5px] text-subtle">{short}</span>
            <span className={has(v) && v > 0 ? "" : "text-subtle"}>{num(v, 0)}</span>
          </span>
        );
      })}
    </span>
  );
}

function ValuationChip({ v }: { v: ThesisBookValuation | null | undefined }) {
  if (!v?.position) return <span className="chip">—</span>;
  return (
    <span className={`chip whitespace-nowrap ${POSITION_CLASS[v.position] ?? ""}`} title={POSITION_TITLES[v.position]}>
      {label(POSITION_LABELS, v.position)}
    </span>
  );
}

/** Signed distance from the price up to the bull scenario; negative means the price is already above it. */
function ToBull({ v }: { v: ThesisBookValuation | null | undefined }) {
  if (!has(v?.pct_to_bull)) return <span className="text-subtle">—</span>;
  return <span className={v.pct_to_bull < 0 ? "text-neg" : ""}>{ptsSigned(v.pct_to_bull, 1)}</span>;
}

function TrendCell({ t }: { t: ThesisBookTechnical | null | undefined }) {
  if (!t || !has(t.passes)) return <span className="text-subtle">—</span>;
  const stage = t.stage ? t.stage.replace(/_/g, " ") : "stage not classified";
  return (
    <span title={`${stage} · trend score ${num(t.score, 0)} · RSI ${num(t.rsi14, 0)}${t.ready ? " · ready" : " · not ready"}`}>
      <span className="font-medium">{num(t.passes, 0)}</span>
      <span className="text-subtle">/8</span>
      {t.ready && <span className="ml-1 text-pos">✓</span>}
    </span>
  );
}

function ThesisIds({ ids }: { ids: string[] | null | undefined }) {
  if (!ids?.length) return <span className="text-subtle">—</span>;
  return (
    <span className="flex gap-1">
      {ids.map((id) => (
        <ThesisRefChip key={id} id={id} />
      ))}
    </span>
  );
}

function TickerCell({ ticker, name }: { ticker: string; name: string | null | undefined }) {
  return (
    <>
      <Link href={companyHref(ticker)} className="font-medium">
        {ticker}
      </Link>
      <div className="max-w-36 truncate text-[11.5px] text-muted" title={name ?? undefined}>
        {name ?? "—"}
      </div>
    </>
  );
}

function KV({ label: l, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1 text-[12.5px] last:border-b-0">
      <span className="text-muted">{l}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function DriverList({ drivers }: { drivers: ThesisBookDriver[] }) {
  if (!drivers.length) return <div className="text-[12.5px] text-muted">No drivers recorded.</div>;
  return (
    <ul className="flex flex-col gap-2">
      {drivers.map((d, i) => {
        const s = has(d.strength) ? Math.max(0, Math.min(1, d.strength)) : null;
        return (
          <li key={i} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-2 text-[12.5px]">
            <span>
              <span className="chip">{label(KIND_LABELS, d.kind)}</span>
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium">{d.label ?? "—"}</span>
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted" title="Strength of this driver for the name (0-100%)">
                  <span className="inline-block h-1.5 w-12 rounded-sm bg-[var(--meter-track)]">
                    {s !== null && <span className="block h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${s * 100}%` }} />}
                  </span>
                  strength {pct(d.strength, 0)}
                </span>
                {has(d.confidence) && <span className="text-[11.5px] text-muted">confidence {pct(d.confidence, 0)}</span>}
              </div>
              {d.detail && <div className="text-muted">{d.detail}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const HOLDING_COLS = 15;

/** Holdings sorted by weight; expand a row for every thesis driver, the sizing notes and the stop / valuation / trend detail. */
export function ThesisHoldingsTable({ rows }: { rows: ThesisBookHolding[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const sorted = [...rows].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const maxW = Math.max(0.0001, ...sorted.map((h) => h.weight ?? 0));

  if (!sorted.length) return <div className="px-4 py-3 text-[12.5px] text-muted">No name favoured by the theses cleared the gates: the book is in cash.</div>;

  const toggle = (t: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div className="tbl-wrap @container">
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-6"></th>
            <th>Ticker</th>
            <th className="num">Weight</th>
            <th></th>
            <th className="num" title="Thesis score (0-100): 40% ledger, 35% structural shifts, 25% morning briefs">Thesis</th>
            <th className="num" title="Probability that the thesis behind the position plays out; sizes the position">Prob</th>
            <th title="Score by source: Ledger / Structural / Brief (each 0-100)">L / S / B</th>
            <th>Top driver</th>
            <th>Theses</th>
            <th title="Where the price sits against the fair-value scenarios">Valuation</th>
            <th className="num" title="Price / base scenario / bull scenario · distance from the price up to the bull scenario">Price / base / bull</th>
            <th className="num" title="Trend-template criteria passed, of 8">Trend</th>
            <th className="num" title="Active stop and the distance down to it">Stop</th>
            <th className="num">P&amp;L</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => {
            const isOpen = open.has(h.ticker);
            const top = h.drivers?.[0] ?? null;
            const pending = h.pending_actions ?? [];
            const v = h.valuation;
            return (
              <Fragment key={h.ticker}>
                <tr>
                  <td className="text-subtle">
                    <button
                      type="button"
                      onClick={() => toggle(h.ticker)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} thesis drivers for ${h.ticker}`}
                      className="grid size-5 place-items-center rounded text-[11px] hover:bg-surface-3 hover:text-ink"
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  </td>
                  <td>
                    <TickerCell ticker={h.ticker} name={h.name} />
                  </td>
                  <td className="num font-medium">{pct(h.weight, 1)}</td>
                  <td>
                    {/* Fixed width on the bar itself: a percentage-width cell collapses once the table scrolls sideways. */}
                    <div className="h-1.5 w-16 rounded-sm bg-[var(--meter-track)]">
                      <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, ((h.weight ?? 0) / maxW) * 100))}%` }} />
                    </div>
                  </td>
                  <td className="num">
                    <ScoreBadge value={h.thesis_score} />
                  </td>
                  <td className="num font-medium">{pct(h.thesis_probability, 0)}</td>
                  <td>
                    <ComponentsCell c={h.components} />
                  </td>
                  <td className="max-w-48 truncate text-muted" title={top ? [top.label, top.detail].filter(Boolean).join(" · ") : undefined}>
                    {top?.label ?? "—"}
                  </td>
                  <td>
                    <ThesisIds ids={h.theses} />
                  </td>
                  <td>
                    <ValuationChip v={v} />
                  </td>
                  <td className="num">
                    {price(v?.price ?? h.price)} <span className="text-subtle">/</span> <span className="text-muted">{price(v?.base)}</span> <span className="text-subtle">/</span>{" "}
                    <span className="text-muted">{price(v?.bull)}</span>
                    <span className="ml-1.5 inline-block w-14 text-right text-[11.5px]" title="Distance from the price up to the bull scenario">
                      <ToBull v={v} />
                    </span>
                  </td>
                  <td className="num">
                    <TrendCell t={h.technical} />
                  </td>
                  <td className="num">
                    {price(h.stops?.active_stop)}
                    {has(h.stops?.stop_distance_pct) && <span className="ml-1 text-[11px] text-subtle">({pts(h.stops.stop_distance_pct, 1)})</span>}
                  </td>
                  <td className={`num font-medium ${signClass(h.pnl_pct)}`}>{ptsSigned(h.pnl_pct, 1)}</td>
                  <td>
                    {h.status === "new" ? <span className="chip border-accent bg-accent-soft text-accent">new</span> : <span className="chip">held</span>}
                    <span className="ml-1.5 text-[11.5px] text-subtle">{date(h.entered)}</span>
                    {pending.length > 0 && (
                      <span className="ml-1.5 text-[11px] text-warn" title={pending.join(" · ")}>
                        {pending.length} pending
                      </span>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-surface-2">
                    <td colSpan={HOLDING_COLS} className="p-0" style={{ whiteSpace: "normal" }}>
                      {/* As wide as the visible wrapper (100cqw) and pinned to its left edge, so the detail stays readable while the table scrolls sideways. */}
                      <div className="sticky left-0 grid w-[100cqw] gap-x-8 gap-y-3 border-l-2 border-line-strong px-3 py-2.5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                        <div className="min-w-0">
                          <div className="eyebrow mb-1.5">Thesis drivers</div>
                          <DriverList drivers={h.drivers ?? []} />
                          {pending.length > 0 && (
                            <div className="mt-3">
                              <div className="eyebrow mb-1">Pending at next recalibration</div>
                              <ul className="flex flex-col gap-0.5 text-[12.5px]">
                                {pending.map((a, i) => (
                                  <li key={i} className="flex gap-2">
                                    <span className="text-warn">·</span>
                                    <span>{a}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="mt-3">
                            <div className="eyebrow mb-1">Sizing notes</div>
                            {h.notes?.length ? (
                              <ul className="flex flex-col gap-0.5 text-[12.5px]">
                                {h.notes.map((s, i) => (
                                  <li key={i} className="flex gap-2">
                                    <span className="text-subtle">·</span>
                                    <span>{s}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="text-[12.5px] text-muted">—</div>
                            )}
                          </div>
                        </div>
                        <div className="grid min-w-0 content-start gap-x-6 gap-y-3 sm:grid-cols-2">
                          <div>
                            <div className="eyebrow mb-1">Position</div>
                            <KV label="Sector" value={h.sector ?? "—"} />
                            <KV label="Top theme" value={h.top_theme ?? "—"} />
                            <KV label="Size" value={<>{money(h.dollars, 1)} · {num(h.shares, 1)} sh</>} />
                            <KV label="Entry → last" value={<>{price(h.entry_price)} → {price(h.price)}</>} />
                            <KV label="Prior weight" value={pct(h.prior_weight, 1)} />
                          </div>
                          <div>
                            <div className="eyebrow mb-1">Stops</div>
                            <KV label="Active" value={price(h.stops?.active_stop)} />
                            <KV label="Initial" value={price(h.stops?.initial_stop)} />
                            <KV label="Trailing" value={price(h.stops?.trailing_stop)} />
                            <KV label="Hard (intra-month)" value={price(h.stops?.hard_stop)} />
                            <KV label="Distance" value={pts(h.stops?.stop_distance_pct, 1)} />
                          </div>
                          <div>
                            <div className="eyebrow mb-1">Fair value</div>
                            <KV label="Bear" value={price(v?.bear)} />
                            <KV label="Base" value={price(v?.base)} />
                            <KV label="Bull" value={price(v?.bull)} />
                            <KV label="Expected return" value={<span className={signClass(v?.expected_return_pct)}>{ptsSigned(v?.expected_return_pct, 1)}</span>} />
                            <KV label="Model confidence" value={v?.confidence ?? "—"} />
                          </div>
                          <div>
                            <div className="eyebrow mb-1">Trend</div>
                            <KV label="Criteria passed" value={has(h.technical?.passes) ? `${num(h.technical.passes, 0)}/8` : "—"} />
                            <KV label="Trend score" value={num(h.technical?.score, 0)} />
                            <KV label="Stage" value={h.technical?.stage ? h.technical.stage.replace(/_/g, " ") : "—"} />
                            <KV label="RSI 14" value={num(h.technical?.rsi14, 0)} />
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Names the theses favour that are not in the book, with the gate that stopped each one. Filter by gate. */
export function ThesisCandidatesTable({ rows }: { rows: ThesisBookCandidate[] }) {
  const [filter, setFilter] = useState<string>("all");
  const notHeld = rows.filter((c) => c.status !== "selected");
  const counts = new Map<string, number>();
  for (const c of notHeld) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  const statuses = [...STATUS_ORDER.filter((s) => counts.has(s)), ...[...counts.keys()].filter((s) => !STATUS_ORDER.includes(s))];
  const active = filter !== "all" && !counts.has(filter) ? "all" : filter;
  const shown = active === "all" ? notHeld : notHeld.filter((c) => c.status === active);

  if (!notHeld.length) return <div className="px-4 py-3 text-[12.5px] text-muted">Every name the theses favour is in the book.</div>;

  const tab = (key: string, text: string, n: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      aria-pressed={active === key}
      className={`chip cursor-pointer ${active === key ? "border-accent bg-accent-soft text-accent" : "hover:text-ink"}`}
    >
      {text} <span className="font-medium">{n}</span>
    </button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
        {tab("all", "All", notHeld.length)}
        {statuses.map((s) => tab(s, label(STATUS_LABELS, s), counts.get(s) ?? 0))}
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Stopped by</th>
              <th className="num" title="Thesis score (0-100)">Thesis</th>
              <th className="num" title="Probability that the thesis behind the name plays out">Prob</th>
              <th title="Score by source: Ledger / Structural / Brief (each 0-100)">L / S / B</th>
              <th title="Where the price sits against the fair-value scenarios">Valuation</th>
              <th className="num" title="Price against the bull scenario · distance from the price up to it (negative = above the bull scenario)">Price vs bull</th>
              <th className="num" title="Trend-template criteria passed, of 8">Trend</th>
              <th>Reason</th>
              <th>Theses</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.ticker} className="align-top">
                <td>
                  <TickerCell ticker={c.ticker} name={c.name} />
                </td>
                <td>
                  <span className={`chip whitespace-nowrap ${STATUS_CLASS[c.status] ?? ""}`}>{label(STATUS_LABELS, c.status)}</span>
                  {c.incumbent && (
                    <span className="ml-1.5 text-[11px] text-accent" title="Held going into this run">
                      incumbent
                    </span>
                  )}
                </td>
                <td className="num">
                  <ScoreBadge value={c.thesis_score} />
                </td>
                <td className="num font-medium">{pct(c.thesis_probability, 0)}</td>
                <td>
                  <ComponentsCell c={c.components} />
                </td>
                <td>
                  <ValuationChip v={c.valuation} />
                </td>
                <td className="num">
                  {price(c.valuation?.price)} <span className="text-subtle">vs</span> <span className="text-muted">{price(c.valuation?.bull)}</span>
                  <span className="ml-1.5 inline-block w-14 text-right text-[11.5px]">
                    <ToBull v={c.valuation} />
                  </span>
                </td>
                <td className="num">
                  <TrendCell t={c.technical} />
                </td>
                <td>
                  <div className="w-64 whitespace-normal text-[12.5px] sm:w-80">{c.reason ?? <span className="text-subtle">—</span>}</div>
                </td>
                <td>
                  <ThesisIds ids={c.theses} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
