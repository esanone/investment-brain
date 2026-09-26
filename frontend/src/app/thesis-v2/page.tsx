import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ThesisV2CalibrationBin, ThesisV2Candidate } from "@/lib/types";
import { date, num } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ProbabilityRange } from "@/components/ProbabilityRange";
import { Section } from "@/components/Section";
import { ThesisV2AnalyzeBriefsButton } from "@/components/ThesisV2AnalyzeBriefsButton";
import { AdoptionStageChip, ConfidenceChip, ReadinessChip, RoleChip, ThesisRefChip, ThesisStatusChip } from "@/components/ThesisV2Chips";
import { ThesisV2NewForm } from "@/components/ThesisV2NewForm";
import { ThesisV2OpportunitiesTable } from "@/components/ThesisV2OpportunitiesTable";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Human Futures Engine" };

const INTRO = "Causal Futures Engine · historical analogies → reference-class prior → Bayesian update → value pools";

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded border border-line bg-surface-2 px-3 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-none">{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

/** Value-pool roles that carry a negative weight in the ranking (causal.py BECOMES_WEIGHT). */
const HEADWIND_BECOMES = new Set(["loses_pricing_power", "new_risk", "abundant"]);

/** Sort calibration bins by their lower bound ("0-10" … "90-100"). */
function binRows(calibration: Record<string, ThesisV2CalibrationBin> | undefined): [string, ThesisV2CalibrationBin][] {
  return Object.entries(calibration ?? {}).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
}

export default async function ThesisV2LedgerPage() {
  const [res, health, oppRes] = await Promise.all([api.thesisV2List(), api.health(), api.thesisV2Opportunities()]);
  const running = health.ok ? Boolean(health.data.running_thesis_v2) : false;
  // The ranking is optional: 404 until the from-briefs job has run; any other failure
  // is shown inline in that section rather than taking the ledger down with it.
  const opps = oppRes.ok ? oppRes.data : null;
  const oppError = oppRes.ok ? null : { status: oppRes.status, message: oppRes.message };
  const candidateByTicker = new Map<string, ThesisV2Candidate>((opps?.candidates ?? []).map((c) => [c.ticker.toUpperCase(), c]));
  const memoPicks = (opps?.memo?.picks ?? []).filter((p) => p.ticker);

  if (!res.ok && res.status !== 404) {
    return (
      <>
        <PageHeader title="Human Futures Engine" subtitle={<span className="text-accent">{INTRO}</span>} />
        <EmptyState message={res.message} />
      </>
    );
  }

  const theses = res.ok ? res.data.theses : [];
  const board = res.ok ? res.data.scoreboard : null;
  const nOpen = board?.open ?? theses.filter((t) => t.status === "open").length;
  const nResolved = board?.resolved ?? theses.filter((t) => t.status === "resolved").length;
  const lastUpdate = theses.map((t) => t.last_update ?? "").filter(Boolean).sort().pop() ?? null;
  const bins = binRows(board?.calibration);

  return (
    <>
      <PageHeader
        title="Human Futures Engine"
        subtitle={<span className="text-accent">{INTRO}</span>}
        meta={
          <>
            {theses.length} thes{theses.length === 1 ? "is" : "es"} · {nOpen} open · {nResolved} resolved · last update {date(lastUpdate)}
            {!res.ok && <> · {res.message}</>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Stocks positioned for the theses"
          subtitle={
            opps
              ? opps.method
              : oppError?.status === 404
                ? "No ranking yet — consolidate the briefs' long-term bullets into theses, analyse them, and rank the universe against their value pools"
                : oppError?.message
          }
          actions={<ThesisV2AnalyzeBriefsButton initialRunning={running} />}
          className="lg:col-span-2"
          flush
        >
          {opps ? (
            <ThesisV2OpportunitiesTable
              rows={opps.candidates ?? []}
              meta={
                <>
                  {opps.n_theses} open thes{opps.n_theses === 1 ? "is" : "es"} · as of <span className="mono">{date(opps.as_of)}</span>
                </>
              }
            />
          ) : (
            <div className="flex flex-col gap-2 px-4 py-3 text-[12.5px] text-muted">
              <p>
                <span className="font-medium text-ink">No ranking yet.</span> Run &ldquo;Analyze brief bullets → theses → stocks&rdquo; above (15-25 min), or from
                the repository root:
              </p>
              <pre className="mono overflow-x-auto rounded border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-6">
                {"cd backend && .venv/bin/python -m brain.pipeline thesis-v2 --from-briefs"}
              </pre>
              {oppError && oppError.status !== 404 && <p className="mono text-[12px] text-neg">{oppError.message}</p>}
            </div>
          )}
        </Section>

        {opps && memoPicks.length > 0 && (
          <Section
            title="Why these"
            subtitle="Rationale for the top candidates, grounded only in the ranking data · an entry condition and the key risk per name"
            className="lg:col-span-2"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {memoPicks.map((pick, i) => {
                const ticker = pick.ticker.toUpperCase();
                const c = candidateByTicker.get(ticker);
                return (
                  <article key={`${ticker}-${i}`} className="flex min-w-0 flex-col gap-1.5 rounded border border-line bg-surface-2 px-3 py-2.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/companies/${ticker}`} className="mono text-[13px] font-semibold hover:text-accent">
                        {ticker}
                      </Link>
                      {c?.name && <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{c.name}</span>}
                      {c && (
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          <span className="text-[11.5px] text-muted" title="Rank score">
                            {num(c.score, 2)}
                          </span>
                          <ReadinessChip value={c.buy_readiness} />
                        </span>
                      )}
                    </div>
                    {c?.theses?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {c.theses.map((x) => (
                          <ThesisRefChip key={x.thesis_id} id={x.thesis_id} contribution={x.contribution} />
                        ))}
                      </div>
                    ) : null}
                    <p className="text-[12.5px] leading-relaxed">{pick.why || "—"}</p>
                    <div className="text-[12px] leading-relaxed">
                      <span className="eyebrow mr-1.5 text-accent">Entry</span>
                      {pick.entry_condition || "—"}
                    </div>
                    <div className="text-[12px] leading-relaxed">
                      <span className="eyebrow mr-1.5 text-warn">Risk</span>
                      {pick.key_risk || "—"}
                    </div>
                  </article>
                );
              })}
            </div>
            {opps.memo?.portfolio_note && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="eyebrow mb-1">Portfolio note</div>
                <p className="text-[13px] leading-relaxed">{opps.memo.portfolio_note}</p>
              </div>
            )}
          </Section>
        )}

        {opps && (
          <Section
            title="Headwinds"
            subtitle="Names whose value-pool roles turn against them under the open theses · loses pricing power, new risk, abundant · headwind < −0.3"
            className="lg:col-span-2"
            flush
          >
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Name</th>
                    <th className="num" title="Sum of the negative contributions (posterior × value-pool weight)">
                      Headwind
                    </th>
                    <th title="Theses with a negative contribution">Theses</th>
                    <th>Roles</th>
                  </tr>
                </thead>
                <tbody>
                  {(opps.losers ?? []).map((l) => {
                    const negTheses = (l.theses ?? []).filter((x) => x.contribution !== null && x.contribution < 0);
                    const negRoles = (l.roles ?? []).filter((x) => HEADWIND_BECOMES.has(x.becomes));
                    return (
                      <tr key={l.ticker} className="align-top">
                        <td>
                          <Link href={`/companies/${l.ticker}`} className="mono font-medium">
                            {l.ticker}
                          </Link>
                        </td>
                        <td className="text-muted">
                          <div className="max-w-44 truncate" title={l.name ?? undefined}>
                            {l.name || "—"}
                          </div>
                        </td>
                        <td className="num font-medium text-neg">{num(l.headwind, 2)}</td>
                        <td>
                          <div className="flex max-w-48 flex-wrap gap-1 whitespace-normal">
                            {negTheses.length ? negTheses.map((x) => <ThesisRefChip key={x.thesis_id} id={x.thesis_id} contribution={x.contribution} />) : <span className="text-muted">—</span>}
                          </div>
                        </td>
                        <td>
                          <div className="flex max-w-xl flex-wrap gap-1 whitespace-normal">
                            {negRoles.length ? (
                              negRoles.map((x, i) => <RoleChip key={`${x.thesis_id}-${i}`} layer={x.layer} becomes={x.becomes} thesisId={x.thesis_id} posterior={x.posterior} />)
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!opps.losers?.length && (
                    <tr>
                      <td colSpan={5} className="text-muted">
                        No headwinds — no universe ticker sits in a negative value pool of an open thesis.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <Section
          title="Thesis ledger"
          subtitle="One row per thesis · posterior with its reasonable range (band), the reference-class prior (tick) · open a row for the full record"
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Thesis</th>
                  <th className="num" title="Posterior probability, percent">Posterior</th>
                  <th title="Band = reasonable range · tick = reference-class prior · marker = posterior">Range</th>
                  <th title="High: ≥ 8 analogues, ≥ 8 evidence items, quality ≥ 70 · Medium: ≥ 5 and ≥ 5 · else Low">Confidence</th>
                  <th>Stage</th>
                  <th>Next confirmation signal</th>
                  <th>Last update</th>
                  <th className="num" title="Monthly reviews recorded">Updates</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {theses.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td>
                      <Link href={`/thesis-v2/${t.id}`} className="mono font-medium">
                        {t.id}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/thesis-v2/${t.id}`} className="font-medium" title={t.statement ?? undefined}>
                        <div className="w-72 whitespace-normal">{t.title ?? "—"}</div>
                      </Link>
                    </td>
                    <td className="num">
                      <span className="text-[15px] font-semibold">{num(t.posterior, 1)}%</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <ProbabilityRange low={t.range_low} high={t.range_high} prior={t.prior} posterior={t.posterior} />
                        <span className="text-[11.5px] text-muted">
                          {num(t.range_low, 0)}–{num(t.range_high, 0)}%
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-subtle">prior {num(t.prior, 1)}%</div>
                    </td>
                    <td>
                      <ConfidenceChip value={t.confidence} />
                    </td>
                    <td>
                      <AdoptionStageChip stage={t.stage} />
                    </td>
                    <td className="max-w-xs truncate text-[12.5px] text-muted" title={t.next_confirmation_signal ?? undefined}>
                      {t.next_confirmation_signal || "—"}
                    </td>
                    <td className="mono text-muted">{date(t.last_update)}</td>
                    <td className="num">{t.n_updates ?? 0}</td>
                    <td>
                      <ThesisStatusChip status={t.status} outcome={t.outcome} />
                      {t.brier && (
                        <div className="mt-0.5 text-[11px] text-subtle" title="Brier score of the final forecast · 0 = perfect, 0.25 = coin flip">
                          Brier {num(t.brier.final, 3)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!theses.length && (
                  <tr>
                    <td colSpan={10} className="text-muted">
                      No thesis yet — create one below
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Scoreboard" subtitle="Brier scores of resolved theses and calibration by stated probability">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Open" value={board ? board.open : "—"} />
            <Tile label="Resolved" value={board ? board.resolved : "—"} />
            <Tile label="Mean Brier · final" value={num(board?.mean_brier_final, 3)} sub="last posterior vs outcome" />
            <Tile label="Mean Brier · time-avg" value={num(board?.mean_brier_time_averaged, 3)} sub="every recorded posterior" />
          </div>
          <div className="mt-4">
            <div className="eyebrow mb-1.5">Calibration bins</div>
            {bins.length ? (
              <div className="tbl-wrap rounded border border-line">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Stated p</th>
                      <th className="num">n</th>
                      <th className="num">Hits</th>
                      <th className="num" title="Mean stated posterior in the bin">Avg p</th>
                      <th className="num" title="Realised frequency">Hit rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bins.map(([bin, b]) => (
                      <tr key={bin}>
                        <td className="mono">{bin}%</td>
                        <td className="num">{b.n}</td>
                        <td className="num">{b.hits}</td>
                        <td className="num">{num(b.avg_p, 0)}%</td>
                        <td className="num font-medium">{num(b.hit_rate, 0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-[12.5px] text-muted">No resolved theses yet — bins fill as theses resolve.</div>
            )}
          </div>
          {board?.note && <p className="mt-3 text-[12px] text-muted">{board.note}</p>}
        </Section>

        <Section
          title="New thesis"
          subtitle="Analysed in the background: formalise → analogues → reference class → evidence → posterior → value pools (~4 min)"
        >
          <ThesisV2NewForm initialRunning={running} />
        </Section>
      </div>
    </>
  );
}
