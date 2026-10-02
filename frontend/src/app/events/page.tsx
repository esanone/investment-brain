import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import type { EarningsEvent, EventGap, FilingRow, HeavySellingRow, InsiderRow, TapeRow } from "@/lib/types";
import { date, money, num, price, ptsSigned, signClass, companyHref } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { EventFlagChips, SeverityChip } from "@/components/EventFlagChips";
import { EventsRunButton } from "@/components/EventsRunButton";
import { InsiderTxTable } from "@/components/InsiderTxTable";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Events" };

const SOURCE_LABELS: Record<string, string> = {
  form4: "Form 4",
  "8k": "8-K",
  earnings_calendar: "Earnings calendar",
  quotes: "Quotes",
};

const HOUR_LABELS: Record<string, string> = { bmo: "before open", amc: "after close", dmh: "during market" };

const FINNHUB_NOTE = "Add FINNHUB_API_KEY to backend/.env for earnings and pre-market gaps";

function TickerLink({ ticker, name, inPortfolio }: { ticker: string; name?: string | null; inPortfolio?: boolean }) {
  return (
    <Link href={companyHref(ticker)} className="flex items-baseline gap-2">
      <span className="mono font-medium">{ticker}</span>
      {name && <span className="max-w-56 truncate font-normal text-muted">{name}</span>}
      {inPortfolio && <PortfolioMark />}
    </Link>
  );
}

function PortfolioMark() {
  return (
    <span className="chip border-accent bg-accent-soft text-accent" title="In the model portfolio">
      portfolio
    </span>
  );
}

function FilingLink({ url, label = "8-K" }: { url: string | null; label?: string }) {
  if (!url) return <span className="text-subtle">—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
      {label}
    </a>
  );
}

function TapeTable({ rows }: { rows: TapeRow[] }) {
  if (!rows.length) return <div className="px-4 py-3 text-[12.5px] text-muted">Nothing on the tape today.</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Company</th>
            <th>Flags</th>
            <th className="num">Priority</th>
            <th>Headline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker} className="align-top">
              <td>
                <TickerLink ticker={r.ticker} name={r.name} inPortfolio={r.in_portfolio} />
                {r.sector && <div className="mt-0.5 text-[11.5px] text-subtle">{r.sector}</div>}
              </td>
              <td>
                <EventFlagChips flags={r.flags} empty />
              </td>
              <td className="num font-medium">{num(r.priority, 0)}</td>
              <td className="max-w-xl whitespace-normal text-[12.5px]">{r.headline || <span className="text-subtle">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InsiderBuyRow({ r, kind }: { r: InsiderRow; kind: "cluster" | "notable" }) {
  const buys = r.recent_buys?.length ? r.recent_buys : r.notable_buys ?? [];
  return (
    <details className="group border-b border-line last:border-b-0">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[12.5px] hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <span className="w-4 shrink-0 text-subtle transition-transform group-open:rotate-90">▸</span>
        <span className="min-w-0 flex-1">
          <TickerLink ticker={r.ticker} name={r.name} />
        </span>
        <span className="chip border-pos bg-pos-soft text-pos">{kind === "cluster" ? "cluster buy" : "notable buy"}</span>
        <span className="w-24 text-right text-muted" title="Distinct insiders buying in the last 14 days">
          {num(r.n_buyers_14d, 0)} buyer{r.n_buyers_14d === 1 ? "" : "s"} 14d
        </span>
        <span className="w-24 text-right font-medium" title="Open-market purchases in the last 45 days">
          {money(r.buy_usd_45d)} bought
        </span>
        <span className={`w-24 text-right ${signClass(r.net_usd_45d)}`} title="Buys − sells over 45 days">
          {money(r.net_usd_45d)} net
        </span>
      </summary>
      <div className="border-t border-line bg-surface-2/40">
        <InsiderTxTable rows={buys} empty="No purchases recorded." />
      </div>
    </details>
  );
}

function HeavySellingTable({ rows }: { rows: HeavySellingRow[] }) {
  if (!rows.length) return <div className="px-4 py-3 text-[12.5px] text-muted">No insider sold more than $5M in the last 45 days.</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Company</th>
            <th className="num">Sold 45d</th>
            <th>Largest sales</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker} className="align-top">
              <td>
                <TickerLink ticker={r.ticker} name={r.name} />
              </td>
              <td className="num font-medium text-neg">{money(r.sell_usd_45d)}</td>
              <td className="max-w-md whitespace-normal text-[12px] text-muted">
                {(r.top_sells ?? []).slice(0, 3).map((t, i) => (
                  <span key={`${t.date}-${i}`}>
                    {i > 0 && " · "}
                    {t.owner || "—"} {money(t.value, 0)} <span className="mono text-subtle">{date(t.date)}</span>
                  </span>
                ))}
                {!(r.top_sells ?? []).length && "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilingsTable({ rows, empty }: { rows: FilingRow[]; empty: string }) {
  if (!rows.length) return <div className="px-4 py-3 text-[12.5px] text-muted">{empty}</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Company</th>
            <th>Filed</th>
            <th>Severity</th>
            <th>Items</th>
            <th>Filing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => (
            <tr key={`${f.ticker}-${f.filed}-${i}`} className="align-top">
              <td>
                <TickerLink ticker={f.ticker} name={f.name} />
              </td>
              <td className="mono whitespace-nowrap">{date(f.filed)}</td>
              <td>
                <SeverityChip severity={f.severity} />
              </td>
              <td className="max-w-md whitespace-normal">
                <span className="inline-flex flex-wrap gap-1">
                  {(f.labels?.length ? f.labels : f.items ?? []).map((l, j) => (
                    <span key={`${l}-${j}`} className="chip">
                      {l}
                    </span>
                  ))}
                  {!(f.labels?.length || f.items?.length) && <span className="text-subtle">—</span>}
                </span>
              </td>
              <td>
                <FilingLink url={f.url} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EarningsTable({ rows, reported, empty }: { rows: EarningsEvent[]; reported?: boolean; empty: string }) {
  if (!rows.length) return <div className="px-4 py-3 text-[12.5px] text-muted">{empty}</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Company</th>
            <th>Date</th>
            <th>Time</th>
            <th className="num">EPS est.</th>
            <th className="num">EPS actual</th>
            {reported && <th className="num">Surprise</th>}
            <th className="num">Revenue est.</th>
            <th className="num">Revenue actual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={`${e.symbol}-${e.date}-${i}`}>
              <td>
                <TickerLink ticker={e.symbol} />
              </td>
              <td className="mono whitespace-nowrap">{date(e.date)}</td>
              <td className="text-muted">{e.hour ? HOUR_LABELS[e.hour] ?? e.hour : "—"}</td>
              <td className="num">{num(e.epsEstimate, 2)}</td>
              <td className="num">{num(e.epsActual, 2)}</td>
              {reported && <td className={`num font-medium ${signClass(e.surprise_pct)}`}>{ptsSigned(e.surprise_pct, 1)}</td>}
              <td className="num text-muted">{money(e.revenueEstimate, 1)}</td>
              <td className="num">{money(e.revenueActual, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GapsTable({ rows }: { rows: EventGap[] }) {
  if (!rows.length) return <div className="px-4 py-3 text-[12.5px] text-muted">No gap of 4% or more in the pre-market quotes.</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Company</th>
            <th className="num">Gap</th>
            <th className="num">Prev close → last</th>
            <th>Related</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.ticker} className="align-top">
              <td>
                <TickerLink ticker={g.ticker} name={g.name} inPortfolio={g.in_portfolio} />
              </td>
              <td className={`num font-semibold ${signClass(g.gap_pct)}`}>{ptsSigned(g.gap_pct, 1)}</td>
              <td className="num whitespace-nowrap">
                <span className="text-muted">{price(g.prev_close)}</span> → {price(g.last)}
              </td>
              <td className="max-w-md whitespace-normal text-[12px]">
                <span className="inline-flex flex-wrap items-center gap-1">
                  {g.earnings && (
                    <span className={`chip ${g.earnings.surprise_pct === null || g.earnings.surprise_pct === undefined ? "" : g.earnings.surprise_pct >= 0 ? "border-pos bg-pos-soft text-pos" : "border-neg bg-neg-soft text-neg"}`}>
                      earnings {ptsSigned(g.earnings.surprise_pct, 1)}
                    </span>
                  )}
                  {g.insider && g.insider !== "none" && (
                    <span className={`chip ${g.insider === "heavy_selling" ? "border-neg bg-neg-soft text-neg" : "border-pos bg-pos-soft text-pos"}`}>
                      insider {g.insider.replace(/_/g, " ")}
                    </span>
                  )}
                  {(g.filings ?? []).map((f, i) => (
                    <span key={`${f.filed}-${i}`} className="chip">
                      8-K {date(f.filed)} {f.labels?.length ? `· ${f.labels.join(", ")}` : ""}{" "}
                      {f.url && (
                        <a href={f.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                          ↗
                        </a>
                      )}
                    </span>
                  ))}
                  {!g.earnings && (!g.insider || g.insider === "none") && !(g.filings ?? []).length && <span className="text-subtle">—</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function EventsPage() {
  const [res, health] = await Promise.all([api.events(), api.health()]);
  const running = health.ok ? Boolean(health.data.running_events) : false;

  if (!res.ok) {
    return (
      <>
        <PageHeader title="Events" actions={<EventsRunButton initialRunning={running} />} />
        {res.status === 404 ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
            <h2 className="text-[15px] font-semibold">No events tape yet</h2>
            <p className="mt-1 text-[13px] text-muted">
              Refresh it with the button above, or build it from the repository root; it scans SEC Form 4 insider transactions and 8-K filings for
              the universe, and (with a Finnhub key) this week&apos;s earnings calendar and pre-market quotes.
            </p>
            <pre className="mono mt-3 overflow-x-auto rounded border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-6">
              {"cd backend && .venv/bin/python -m brain.pipeline events"}
            </pre>
            <p className="mono mt-2 text-[12px] text-subtle">{res.message}</p>
          </div>
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }

  const ev = res.data;
  const sources = Object.entries(ev.sources ?? {});
  const tape = ev.tape ?? [];
  const clusterBuys = ev.insider?.cluster_buys ?? [];
  const notableBuys = ev.insider?.notable_buys ?? [];
  const heavySelling = ev.insider?.heavy_selling ?? [];
  const filingsHigh = ev.filings?.high ?? [];
  const filingsMedium = ev.filings?.medium ?? [];
  const filingsResults = ev.filings?.results ?? [];
  const earnToday = ev.earnings?.today ?? [];
  const earnWeek = ev.earnings?.this_week ?? [];
  const earnReported = ev.earnings?.reported ?? [];
  const gaps = ev.gaps ?? [];
  // Both Finnhub-backed feeds empty: most likely no API key rather than a quiet week.
  const finnhubMissing = !(ev.sources?.earnings_calendar ?? 0) && !(ev.sources?.quotes ?? 0);
  const nInsider = clusterBuys.length + notableBuys.length;
  const nFilings = filingsHigh.length + filingsMedium.length + filingsResults.length;

  return (
    <>
      <PageHeader
        title="Events"
        subtitle={ev.method}
        meta={
          <>
            as of {date(ev.as_of)} · {tape.length} on the tape · {nInsider} insider buy{nInsider === 1 ? "" : "s"} · {nFilings} 8-K{nFilings === 1 ? "" : "s"} ·{" "}
            {gaps.length} gap{gaps.length === 1 ? "" : "s"}
          </>
        }
        actions={<EventsRunButton initialRunning={running} />}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {sources.map(([name, n]) => (
          <span key={name} className={`chip ${n ? "" : "border-warn bg-warn-soft text-warn"}`}>
            <span className={n ? "text-ink" : ""}>{SOURCE_LABELS[name] ?? name}</span> · {num(n, 0)}
          </span>
        ))}
        {!sources.length && <span className="text-[12.5px] text-muted">No sources recorded.</span>}
        {ev.rules && (
          <span className="chip" title="Engine thresholds">
            cluster {ev.rules.cluster_min_insiders}+ in {ev.rules.cluster_days}d · notable ≥ {money(ev.rules.notable_buy_usd, 0)} · lookback {ev.rules.lookback_days}d · gap ≥{" "}
            {num(ev.rules.gap_pct, 0)}%
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* PRE-OPEN TAPE */}
        <Section title={`Pre-open tape · ${tape.length}`} subtitle="Portfolio names first, then by priority · one line per company with at least one trigger" className="lg:col-span-2" flush>
          <TapeTable rows={tape} />
        </Section>

        {/* INSIDER BUYING */}
        <Section
          title={`Insider buying · ${nInsider}`}
          subtitle="Open-market purchases (Form 4 code P) · click a row for the transactions"
          className={heavySelling.length ? "" : "lg:col-span-2"}
          flush
        >
          {nInsider ? (
            <div>
              {clusterBuys.map((r) => (
                <InsiderBuyRow key={`c-${r.ticker}`} r={r} kind="cluster" />
              ))}
              {notableBuys.map((r) => (
                <InsiderBuyRow key={`n-${r.ticker}`} r={r} kind="notable" />
              ))}
            </div>
          ) : (
            <div className="px-4 py-3 text-[12.5px] text-muted">No cluster or notable insider buys in the last {ev.rules?.lookback_days ?? 45} days.</div>
          )}
        </Section>

        {/* HEAVY SELLING */}
        {heavySelling.length > 0 && (
          <Section title={`Heavy selling · ${heavySelling.length}`} subtitle="Insiders sold more than $5M in 45 days · context, not a signal on its own" flush>
            <HeavySellingTable rows={heavySelling} />
          </Section>
        )}

        {/* 8-K FILINGS */}
        <Section title={`8-K filings · ${nFilings}`} subtitle="High severity first, then medium, then results filed (item 2.02)" className="lg:col-span-2" flush>
          <div className="divide-y divide-line">
            <div>
              <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                <span className="eyebrow">High severity</span>
                <span className="chip border-neg bg-neg-soft text-neg">{filingsHigh.length}</span>
              </div>
              <FilingsTable rows={filingsHigh} empty="No high-severity 8-K this period." />
            </div>
            <div>
              <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                <span className="eyebrow">Medium severity</span>
                <span className="chip border-warn bg-warn-soft text-warn">{filingsMedium.length}</span>
              </div>
              <FilingsTable rows={filingsMedium} empty="No medium-severity 8-K this period." />
            </div>
            <div>
              <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                <span className="eyebrow">Results filed</span>
                <span className="chip">{filingsResults.length}</span>
              </div>
              <FilingsTable rows={filingsResults} empty="No results 8-K this period." />
            </div>
          </div>
        </Section>

        {/* EARNINGS + PRE-MARKET GAPS (Finnhub) */}
        {finnhubMissing ? (
          <div className="text-[12.5px] text-muted lg:col-span-2">{FINNHUB_NOTE}</div>
        ) : (
          <>
            <Section title={`Earnings · ${earnWeek.length} this week`} subtitle="Finnhub calendar for the universe · surprise = (actual − estimate) / |estimate|" className="lg:col-span-2" flush>
              <div className="divide-y divide-line">
                <div>
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                    <span className="eyebrow">Today</span>
                    <span className="chip border-warn bg-warn-soft text-warn">{earnToday.length}</span>
                  </div>
                  <EarningsTable rows={earnToday} empty="No universe company reports today." />
                </div>
                <div>
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                    <span className="eyebrow">This week</span>
                    <span className="chip">{earnWeek.length}</span>
                  </div>
                  <EarningsTable rows={earnWeek} empty="No universe company reports this week." />
                </div>
                <div>
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                    <span className="eyebrow">Reported</span>
                    <span className="chip">{earnReported.length}</span>
                  </div>
                  <EarningsTable rows={earnReported} reported empty="Nothing reported yet this week." />
                </div>
              </div>
            </Section>

            <Section title={`Pre-market gaps · ${gaps.length}`} subtitle={`Moves of ${num(ev.rules?.gap_pct ?? 4, 0)}% or more vs the previous close, largest first`} className="lg:col-span-2" flush>
              <GapsTable rows={gaps} />
            </Section>
          </>
        )}
      </div>
    </>
  );
}
