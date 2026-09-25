"use client";

import { useState } from "react";
import Link from "next/link";
import type { EntryRule, Holding } from "@/lib/types";
import { date, money, num, pct, price, pts, ptsSigned, signed, signClass, yesNo } from "@/lib/format";
import { ScoreBadge } from "./ScoreBadge";

/** Human labels for the trend-template stage (technicals.py `trend_template`). */
export const STAGE_LABELS: Record<string, string> = {
  stage2_uptrend: "Stage 2 uptrend",
  emerging: "Emerging",
  basing_or_downtrend: "Basing / downtrend",
};

/** Stage chip: green for a confirmed uptrend, muted for emerging, red for basing/downtrend. */
export function StageChip({ stage }: { stage: string | null | undefined }) {
  if (!stage) return <span className="chip">—</span>;
  const cls = stage === "stage2_uptrend" ? "border-pos bg-pos-soft text-pos" : stage === "basing_or_downtrend" ? "border-neg bg-neg-soft text-neg" : "";
  return <span className={`chip ${cls}`}>{STAGE_LABELS[stage] ?? stage}</span>;
}

/** Signed percent-points P&L with green/red colour. */
function Pnl({ v }: { v: number | null | undefined }) {
  return <span className={signClass(v)}>{ptsSigned(v, 1)}</span>;
}

function KV({ label, value, cls = "" }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1 text-[12.5px] last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className={`font-medium ${cls}`}>{value}</span>
    </div>
  );
}

/** Metrics stored as fractions (0.12 = 12%); everything else is a plain number. */
const FRACTION_METRICS = new Set(["revenue_growth", "roic", "operating_margin_change"]);

export function ruleValue(metric: string, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return FRACTION_METRICS.has(metric) ? pct(v, 1) : num(v, Number.isInteger(v) ? 0 : 1);
}

/** Entry-rule table shared by holdings (expanded row) and exits. */
export function RulesTable({ rules, evaluated }: { rules: EntryRule[]; evaluated: boolean }) {
  if (!rules.length) return <div className="px-4 py-2 text-[12.5px] text-muted">No entry rules recorded.</div>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Rule</th>
          <th>Metric</th>
          <th className="num">Op</th>
          <th className="num">Threshold</th>
          <th className="num">Current</th>
          {evaluated && <th>Status</th>}
        </tr>
      </thead>
      <tbody>
        {rules.map((r, i) => {
          const hit = r.triggered === true;
          return (
            <tr key={`${r.id}-${i}`} className={evaluated && hit ? "font-medium" : ""}>
              <td>
                {r.label}
                {r.consecutive && r.consecutive > 1 && <span className="ml-1.5 text-[11px] text-subtle">×{r.consecutive} runs</span>}
                {r.and_negative_rs && <span className="ml-1.5 text-[11px] text-subtle">and RS &lt; 0</span>}
              </td>
              <td className="mono text-muted">{r.metric}</td>
              <td className="num text-muted">{r.op}</td>
              <td className="num">{ruleValue(r.metric, r.threshold)}</td>
              <td className="num">{ruleValue(r.metric, r.current)}</td>
              {evaluated && (
                <td className={hit ? "text-neg" : "text-pos"}>
                  <span className="mr-1">{hit ? "✗" : "✓"}</span>
                  {hit ? "TRIGGERED" : "intact"}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const COLS = 25;

/** Holdings table with expandable rows showing each position's frozen entry rules. */
export function HoldingsTable({ rows }: { rows: Holding[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const sorted = [...rows].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const maxW = Math.max(0.0001, ...sorted.map((h) => h.weight ?? 0));

  if (!sorted.length) return <div className="px-4 py-3 text-[12.5px] text-muted">No equity holdings in this snapshot.</div>;

  const toggle = (t: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-6"></th>
            <th>Ticker</th>
            <th>Name</th>
            <th>Sector</th>
            <th>Theme</th>
            <th className="num">Weight</th>
            <th></th>
            <th className="num">$</th>
            <th className="num">Shares</th>
            <th className="num">Entry</th>
            <th className="num">Last</th>
            <th className="num">P&amp;L %</th>
            <th className="num" title="Calendar days held · ✓ = eligible for long-term capital-gains treatment">Held</th>
            <th className="num">Stop</th>
            <th className="num">Trail</th>
            <th className="num" title="Trend-template score (0-100)">Tech</th>
            <th className="num" title="Long-term theme conviction (0-1)">LT</th>
            <th className="num" title="Attention score (0-100)">Attn</th>
            <th className="num">Conviction</th>
            <th className="num">Opp</th>
            <th className="num">Gap</th>
            <th className="num">Reality</th>
            <th className="num">Pricing</th>
            <th className="num">Quality</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => {
            const isOpen = open.has(h.ticker);
            const rules = h.rule_status ?? h.entry_rules ?? [];
            const evaluated = h.rule_status !== null && h.rule_status !== undefined;
            const triggered = evaluated ? rules.filter((r) => r.triggered).length : 0;
            return (
              <HoldingRow
                key={h.ticker}
                h={h}
                isOpen={isOpen}
                onToggle={() => toggle(h.ticker)}
                barPct={((h.weight ?? 0) / maxW) * 100}
                rules={rules}
                evaluated={evaluated}
                triggered={triggered}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HoldingRow({
  h,
  isOpen,
  onToggle,
  barPct,
  rules,
  evaluated,
  triggered,
}: {
  h: Holding;
  isOpen: boolean;
  onToggle: () => void;
  barPct: number;
  rules: EntryRule[];
  evaluated: boolean;
  triggered: number;
}) {
  const stops = h.stops ?? null;
  const ta = h.technical ?? null;
  const flags = h.brief_flags ?? 0;
  const techFails = h.tech_fail_runs ?? 0;
  return (
    <>
      <tr>
        <td className="text-subtle">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Hide" : "Show"} entry rules for ${h.ticker}`}
            className="grid size-5 place-items-center rounded text-[11px] hover:bg-surface-3 hover:text-ink"
          >
            {isOpen ? "▾" : "▸"}
          </button>
        </td>
        <td>
          <Link href={`/companies/${h.ticker}`} className="font-medium">
            {h.ticker}
          </Link>
        </td>
        <td className="max-w-56 truncate text-muted">{h.name}</td>
        <td className="text-muted">{h.sector}</td>
        <td className="max-w-48 truncate text-muted">{h.top_theme ?? "—"}</td>
        <td className="num font-medium">{pct(h.weight, 1)}</td>
        <td className="w-20">
          <div className="h-1.5 w-full rounded-sm bg-[var(--meter-track)]">
            <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, barPct))}%` }} />
          </div>
        </td>
        <td className="num">{money(h.dollars, 1)}</td>
        <td className="num text-muted">{num(h.shares, 1)}</td>
        <td className="num text-muted">{price(h.entry_price)}</td>
        <td className="num">{price(h.price)}</td>
        <td className="num font-medium"><Pnl v={h.pnl_pct} /></td>
        <td className="num">
          {num(h.held_days, 0)}
          {h.long_term_gain_eligible && (
            <span className="ml-1 text-pos" title="Long-term capital-gains eligible">
              ✓
            </span>
          )}
        </td>
        <td className="num">
          {price(stops?.active_stop)}
          {stops?.stop_distance_pct !== null && stops?.stop_distance_pct !== undefined && (
            <span className="ml-1 text-[11px] text-subtle">({pts(stops.stop_distance_pct, 1)})</span>
          )}
        </td>
        <td className="num text-muted">{price(stops?.trailing_stop)}</td>
        <td className="num" title={ta ? `${STAGE_LABELS[ta.stage] ?? ta.stage} · ${ta.passes}/8 criteria${ta.ready ? " · ready" : ""}` : undefined}>
          {ta ? <ScoreBadge value={ta.score} /> : "—"}
        </td>
        <td className="num">{pct(h.lt_conviction, 0)}</td>
        <td className="num text-muted">{num(h.attention, 0)}</td>
        <td className="num">{num(h.conviction, 1)}</td>
        <td className="num"><ScoreBadge value={h.opportunity} /></td>
        <td className={`num ${signClass(h.gap)}`}>{signed(h.gap, 0)}</td>
        <td className="num">{num(h.reality, 0)}</td>
        <td className="num">{num(h.pricing, 0)}</td>
        <td className="num"><ScoreBadge value={h.quality} /></td>
        <td>
          {h.status === "new" ? (
            <span className="chip border-accent bg-accent-soft text-accent">new</span>
          ) : (
            <span className="chip">held</span>
          )}
          <span className="ml-1.5 text-[11.5px] text-subtle">{date(h.entered)}</span>
          {evaluated && triggered > 0 && <span className="ml-1.5 text-[11px] text-neg">{triggered} rule{triggered > 1 ? "s" : ""} hit</span>}
          {flags > 0 && <span className="ml-1.5 text-[11px] text-warn">{flags} brief flag{flags > 1 ? "s" : ""}</span>}
        </td>
        <td className="max-w-72 truncate text-[12px] text-muted" title={h.notes?.join(" · ")}>
          {h.notes?.length ? h.notes.join(" · ") : "—"}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-surface-2">
          <td colSpan={COLS + 1} className="p-0" style={{ whiteSpace: "normal" }}>
            <div className="grid gap-x-6 gap-y-2 border-l-2 border-line-strong px-3 py-2 lg:grid-cols-[1fr_minmax(0,2fr)]">
              <div className="text-[12.5px]">
                <div className="eyebrow mb-1">Rationale</div>
                {h.rationale?.length ? (
                  <ul className="flex flex-col gap-0.5">
                    {h.rationale.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-subtle">·</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-muted">—</div>
                )}
                <div className="mt-2 text-[11.5px] text-muted">
                  growth {num(h.growth, 0)} · value {num(h.value, 0)} · macro fit {num(h.macro_fit, 0)} · price {money(h.price, 2)}
                  {h.narrative !== null && h.narrative !== undefined && <> · narrative {num(h.narrative, 0)}</>}
                  {h.prior_weight !== null && h.prior_weight !== undefined && <> · prior weight {pct(h.prior_weight, 1)}</>}
                  {h.held_days !== null && h.held_days !== undefined && (
                    <>
                      {" "}
                      · held {num(h.held_days, 0)} days{h.long_term_gain_eligible ? <span className="text-pos"> · LT gains ✓</span> : ""}
                    </>
                  )}
                </div>
                {h.pending_actions !== undefined && (
                  <div className="mt-3">
                    <div className="eyebrow mb-1">Pending at next recalibration</div>
                    {h.pending_actions.length ? (
                      <ul className="flex flex-col gap-0.5">
                        {h.pending_actions.map((a, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-warn">·</span>
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-muted">No pending actions.</div>
                    )}
                  </div>
                )}
                <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <div>
                    <div className="eyebrow mb-1">Stops</div>
                    {stops ? (
                      <>
                        <KV label="Entry" value={price(h.entry_price)} />
                        <KV label="Initial stop" value={price(stops.initial_stop)} />
                        <KV label="Trailing stop" value={price(stops.trailing_stop)} cls={stops.trailing_stop === null || stops.trailing_stop === undefined ? "text-subtle" : ""} />
                        <KV label="Active stop" value={<>{price(stops.active_stop)} <span className="text-[11px] text-subtle">{pts(stops.stop_distance_pct, 1)} away</span></>} />
                        <KV label="Hard stop" value={price(stops.hard_stop)} cls="text-neg" />
                        <KV label="Trail high" value={price(h.trail_high)} />
                        <KV label="P&L since entry" value={<Pnl v={h.pnl_pct} />} />
                      </>
                    ) : (
                      <div className="text-[12.5px] text-muted">No stop ladder recorded (pre-v2 snapshot).</div>
                    )}
                  </div>
                  <div>
                    <div className="eyebrow mb-1">Trend template</div>
                    {ta ? (
                      <>
                        <KV label="Score" value={<><ScoreBadge value={ta.score} /> <span className="text-[11px] text-subtle">{ta.passes}/8</span></>} />
                        <KV label="Stage" value={<StageChip stage={ta.stage} />} />
                        <KV label="Ready" value={yesNo(ta.ready)} cls={ta.ready ? "text-pos" : "text-muted"} />
                        <KV label="RSI 14" value={num(ta.rsi14, 0)} cls={ta.rsi14 !== null && ta.rsi14 !== undefined && ta.rsi14 >= 75 ? "text-warn" : ""} />
                        <KV label="ATR %" value={pts(ta.atr_pct, 2)} />
                        <KV label="6m RS vs SPY" value={ptsSigned(ta.rs_6m, 1)} cls={signClass(ta.rs_6m)} />
                        <KV label="From 52w high" value={ptsSigned(ta.pct_from_52w_high, 1)} cls={signClass(ta.pct_from_52w_high)} />
                      </>
                    ) : (
                      <div className="text-[12.5px] text-muted">No trend-template read.</div>
                    )}
                    {techFails > 0 && (
                      <div className="mt-1.5 text-[12px] text-warn">trend-template failures: {techFails} run{techFails > 1 ? "s" : ""}</div>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1">
                  Entry rules {evaluated ? "· re-evaluated this run" : "· frozen at entry, not yet re-evaluated"}
                </div>
                <div className="overflow-x-auto rounded border border-line bg-surface">
                  <RulesTable rules={rules} evaluated={evaluated} />
                </div>
                <div className="mt-3">
                  <div className="eyebrow mb-1">
                    Morning-brief flags{flags > 0 ? ` · ${flags} consecutive` : ""}
                  </div>
                  {h.brief_notes?.length ? (
                    <ul className="flex flex-col gap-0.5 text-[12.5px]">
                      {h.brief_notes.map((n, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-warn">·</span>
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[12.5px] text-muted">{flags > 0 ? `${flags} flag${flags > 1 ? "s" : ""}, no notes recorded.` : "No trim/review flags in recent briefs."}</div>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
