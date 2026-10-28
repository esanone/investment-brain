import Link from "next/link";
import type { Cooldowns, Num, PortfolioQueueRow, ThesisBookQueueRow } from "@/lib/types";
import { companyHref, date, num, pct, ptsSigned, signClass } from "@/lib/format";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Section } from "@/components/Section";
import { ThesisIds, TickerCell, ToBull, TrendCell, ValuationChip } from "@/components/ThesisBookTables";

/**
 * "Next in line": the replacement queue of a stock book (valuation-trend or thesis-driven), the note on the
 * most recent exit and the names in cool-down. Renders nothing when the snapshot predates the queue.
 */

type Rules = Record<string, unknown> | null | undefined;

const DEFAULT_QUEUE_RUNS = 3;

function ruleNum(rules: Rules, key: string): number | null {
  const v = rules?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function has(v: Num | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

/** Consecutive runs passed as a small bar plus "2/3", with the Eligible chip once the threshold is met. */
function RunsCell({ runs, needed, eligible }: { runs: number; needed: number; eligible: boolean }) {
  const r = Math.max(0, runs ?? 0);
  const width = needed > 0 ? Math.max(0, Math.min(100, (r / needed) * 100)) : 0;
  return (
    <span className="inline-flex items-center gap-2" title={`${r} of ${needed} consecutive runs passing every gate`}>
      <span className="inline-block h-1.5 w-10 rounded-sm bg-[var(--meter-track)]">
        <span className={`block h-full rounded-sm ${eligible ? "bg-[var(--pos)]" : "bg-[var(--meter-fill)]"}`} style={{ width: `${width}%` }} />
      </span>
      <span className="mono">
        {r}
        <span className="text-subtle">/{needed}</span>
      </span>
      {eligible && <span className="chip border-pos bg-pos-soft text-pos">Eligible</span>}
    </span>
  );
}

function Theme({ t }: { t: string | null }) {
  return (
    <div className="max-w-44 truncate text-muted" title={t ?? undefined}>
      {t ?? <span className="text-subtle">—</span>}
    </div>
  );
}

type Props = {
  rules: Rules;
  cooldowns: Cooldowns | null | undefined;
  replacementNote: string | null | undefined;
  replacementsThisMonth: number | null | undefined;
  className?: string;
} & ({ book: "valuation"; queue: PortfolioQueueRow[] | undefined } | { book: "thesis"; queue: ThesisBookQueueRow[] | undefined });

export function NextInLine(props: Props) {
  const { rules, cooldowns, replacementNote, replacementsThisMonth, className = "" } = props;
  if (props.queue === undefined) return null;

  const queueRuns = ruleNum(rules, "queue_runs") ?? DEFAULT_QUEUE_RUNS;
  const perMonth = ruleNum(rules, "replacements_per_month");
  const cooldownDays = ruleNum(rules, "stopout_cooldown_days");
  const cooled = Object.entries(cooldowns ?? {}).sort((a, b) => a[1].localeCompare(b[1]));
  const positive = !!replacementNote && /replaced by/i.test(replacementNote);
  const eligibleCount = props.queue.filter((q) => q.eligible).length;

  const empty = <div className="px-4 py-3 text-[12.5px] text-muted">No name passes every gate today.</div>;

  const header = (
    <>
      <th>Ticker</th>
      <th>Sector</th>
      <th title={`Consecutive runs passing every gate · eligible at ${queueRuns}`}>Runs</th>
    </>
  );

  return (
    <Section
      title="Next in line"
      subtitle={`Names passing every entry gate today. A name becomes eligible after ${queueRuns} consecutive runs; a lone mid-month exit is refilled from the top of this list, a systemic exit waits for the recalibration.`}
      className={className}
      actions={
        props.queue.length ? (
          <span className="chip" title="Names in the queue · eligible to refill an exit today">
            {props.queue.length} queued · {eligibleCount} eligible
          </span>
        ) : undefined
      }
      flush
    >
      {(replacementNote || has(replacementsThisMonth)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2 text-[12px]">
          {replacementNote && (
            <span className={`chip whitespace-normal ${positive ? "border-pos bg-pos-soft text-pos" : "border-warn bg-warn-soft text-warn"}`}>{replacementNote}</span>
          )}
          {has(replacementsThisMonth) && (
            <span className="text-muted">
              {num(replacementsThisMonth, 0)} of {perMonth === null ? "—" : num(perMonth, 0)} replacements used this month
            </span>
          )}
        </div>
      )}

      {!props.queue.length ? (
        empty
      ) : props.book === "valuation" ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {header}
                <th className="num" title="Strategist conviction (0-100)">Conviction</th>
                <th className="num" title="Portfolio-management Entry Score (0-100)">Entry</th>
                <th className="num" title="Expected return to fair value, percent points">Exp. return</th>
                <th className="num" title="Trend-template criteria passed, of 8">Trend</th>
                <th>Top theme</th>
              </tr>
            </thead>
            <tbody>
              {props.queue.map((q) => (
                <tr key={q.ticker}>
                  <td>
                    <TickerCell ticker={q.ticker} name={q.name} />
                  </td>
                  <td className="text-muted">{q.sector ?? "—"}</td>
                  <td>
                    <RunsCell runs={q.runs} needed={queueRuns} eligible={q.eligible} />
                  </td>
                  <td className="num">
                    <ScoreBadge value={q.conviction} />
                  </td>
                  <td className="num">
                    <ScoreBadge value={q.entry_score} />
                  </td>
                  <td className={`num font-medium ${signClass(q.expected_return_pct)}`}>{ptsSigned(q.expected_return_pct, 1)}</td>
                  <td className="num">
                    <TrendCell t={q.trend} />
                  </td>
                  <td>
                    <Theme t={q.top_theme} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {header}
                <th className="num" title="Thesis score (0-100)">Thesis</th>
                <th className="num" title="Probability that the thesis behind the name plays out">Prob</th>
                <th title="Where the price sits against the fair-value scenarios · distance from the price up to the bull scenario">Valuation</th>
                <th className="num" title="Trend-template criteria passed, of 8">Trend</th>
                <th>Top theme</th>
                <th>Theses</th>
              </tr>
            </thead>
            <tbody>
              {props.queue.map((q) => (
                <tr key={q.ticker}>
                  <td>
                    <TickerCell ticker={q.ticker} name={q.name} />
                  </td>
                  <td className="text-muted">{q.sector ?? "—"}</td>
                  <td>
                    <RunsCell runs={q.runs} needed={queueRuns} eligible={q.eligible} />
                  </td>
                  <td className="num">
                    <ScoreBadge value={q.thesis_score} />
                  </td>
                  <td className="num font-medium">{pct(q.thesis_probability, 0)}</td>
                  <td>
                    <ValuationChip v={q.valuation} />
                    <span className="ml-1.5 inline-block w-14 text-right text-[11.5px]" title="Distance from the price up to the bull scenario">
                      <ToBull v={q.valuation} />
                    </span>
                    {has(q.valuation?.pct_to_bull) && <span className="ml-0.5 text-[11px] text-subtle">to bull</span>}
                  </td>
                  <td className="num">
                    <TrendCell t={q.technical} />
                  </td>
                  <td>
                    <Theme t={q.top_theme} />
                  </td>
                  <td>
                    <ThesisIds ids={q.theses} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cooled.length > 0 && (
        <div className="border-t border-line px-4 py-2 text-[12px] text-muted" title={`${cooldownDays === null ? "" : `${num(cooldownDays, 0)}-day cool-down · `}barred from the queue until the date shown`}>
          In cool-down after a stop-out:{" "}
          {cooled.map(([t, until], i) => (
            <span key={t}>
              {i > 0 && ", "}
              <Link href={companyHref(t)} className="mono font-medium text-ink hover:text-accent">
                {t}
              </Link>{" "}
              until {date(until)}
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}
