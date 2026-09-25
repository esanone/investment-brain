import Link from "next/link";
import { api } from "@/lib/api";
import { IS_STATIC } from "@/lib/static";
import { MECHANISM_KEYS, SCENARIO_KEYS } from "@/lib/types";
import { MECHANISM_LABELS, date, num, pct, signed, signClass } from "@/lib/format";
import { AnaloguesTable, SIMILARITY_CUTOFF } from "@/components/AnaloguesTable";
import { EmptyState } from "@/components/EmptyState";
import { EvidenceTable } from "@/components/EvidenceTable";
import { PageHeader } from "@/components/PageHeader";
import { ProbabilityHistoryChart } from "@/components/ProbabilityHistoryChart";
import { ProbabilityRange } from "@/components/ProbabilityRange";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Section } from "@/components/Section";
import { AdoptionStageChip, BecomesChip, ConfidenceChip, ContradictoryChip, ThesisStatusChip } from "@/components/ThesisV2Chips";
import { ThesisV2Actions } from "@/components/ThesisV2Actions";

export * from "@/lib/segment-config-dynamic-route";

/**
 * Static export: one page per thesis in the exported ledger (public/data/api/thesis-v2.json).
 * Live mode renders on demand. `output: "export"` refuses an empty list, so a snapshot
 * without any thesis yet prerenders one placeholder id that renders the "No thesis" card.
 */
export async function generateStaticParams(): Promise<{ id: string }[]> {
  if (!IS_STATIC) return [];
  const res = await api.thesisV2List();
  const ids = res.ok ? res.data.theses.map((t) => ({ id: t.id })) : [];
  return ids.length ? ids : [{ id: "none" }];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Thesis v2 · ${id.toUpperCase()}` };
}

const SCENARIO_LABELS: Record<string, string> = { bull: "Bull", base: "Base", bear: "Bear" };

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 border-b border-line py-1.5 text-[13px] last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0">{value}</span>
    </div>
  );
}

function Bullets({
  items,
  empty = "Nothing recorded.",
  marker = "·",
  markerCls = "text-subtle",
}: {
  items: (string | null | undefined)[] | null | undefined;
  empty?: string;
  marker?: string;
  markerCls?: string;
}) {
  const list = (items ?? []).filter((x): x is string => !!x);
  if (!list.length) return <div className="text-[12.5px] text-muted">{empty}</div>;
  return (
    <ul className="flex flex-col gap-1 text-[13px]">
      {list.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className={markerCls}>{marker}</span>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

/** One row of the output table: label column + free-wrapping value column. */
function OutputRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <tr className="align-top">
      <td className="w-56 text-muted" title={hint}>
        {label}
      </td>
      <td style={{ whiteSpace: "normal" }}>{value}</td>
    </tr>
  );
}

export default async function ThesisV2Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = rawId.toUpperCase();
  const [res, health] = await Promise.all([api.thesisV2(id), api.health()]);
  const running = health.ok ? Boolean(health.data.running_thesis_v2) : false;

  if (!res.ok) {
    return (
      <>
        <PageHeader title={`Thesis v2 · ${id}`} meta={<Link href="/thesis-v2" className="hover:text-accent">← Thesis ledger</Link>} />
        {res.status === 404 ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
            <h2 className="text-[15px] font-semibold">No thesis {id}</h2>
            <p className="mt-1 text-[13px] text-muted">
              Nothing has been analysed under this id. Open the{" "}
              <Link href="/thesis-v2" className="text-accent hover:underline">
                thesis ledger
              </Link>{" "}
              to see what exists or to create one.
            </p>
            <p className="mono mt-2 text-[12px] text-subtle">{res.message}</p>
          </div>
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }

  const t = res.data;
  const p = t.probability;
  const rc = t.reference_class;
  const f = t.formalized;
  const st = t.stage;
  const ind = t.indicators;
  const activeEvidence = (t.evidence ?? []).filter((e) => !e.retired).length;
  const history = t.probability_history ?? [];
  const updates = [...(t.updates ?? [])].reverse();
  const sourceBullets = (t.source_bullets ?? []).filter((b) => b && b.text);
  const sourceDates = new Set(sourceBullets.map((b) => date(b.date)));

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>{t.title}</span>
            <ThesisStatusChip status={t.status} outcome={t.outcome} />
            <ConfidenceChip value={p?.confidence} />
            {t.origin === "briefs" && (
              <span className="chip" title="Consolidated from the morning briefs' long-term human-behaviour bullets (see Source observations)">
                origin: briefs
              </span>
            )}
          </span>
        }
        subtitle={f?.statement}
        meta={
          <>
            <Link href="/thesis-v2" className="hover:text-accent">
              Thesis v2
            </Link>{" "}
            · {t.id} · created {date(t.created)} → horizon {date(t.horizon)} · last update {date(t.last_update)}
            {t.resolved && <> · resolved {date(t.resolved)}</>}
          </>
        }
        actions={<ThesisV2Actions id={t.id} status={t.status} initialRunning={running} />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Output"
          subtitle={<span className="text-accent">Probability computed in log-odds from the reference class and the weighted evidence · never stated by the model</span>}
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <tbody>
                <OutputRow
                  label="Thesis probability"
                  hint="Posterior probability that the formalized statement holds by the horizon"
                  value={
                    <span className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-[28px] font-semibold leading-none">{num(p?.posterior, 1)}%</span>
                      <span className="text-[12px] text-muted">
                        from a {num(p?.prior, 1)}% prior · {p?.n_evidence ?? activeEvidence} active evidence items
                      </span>
                    </span>
                  }
                />
                <OutputRow
                  label="Reasonable range"
                  hint="Posterior with the evidence counted at half and one-and-a-half strength, widened for thin evidence"
                  value={
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">
                        {num(p?.range_low, 0)}% – {num(p?.range_high, 0)}%
                      </span>
                      <ProbabilityRange low={p?.range_low} high={p?.range_high} prior={p?.prior} posterior={p?.posterior} className="w-44" />
                      <span className="text-[11.5px] text-subtle">tick = prior · marker = posterior</span>
                    </span>
                  }
                />
                <OutputRow
                  label="Historical analogy strength"
                  hint={`Mean similarity of the analogues at or above ${SIMILARITY_CUTOFF}`}
                  value={
                    <span className="flex items-baseline gap-2">
                      <ScoreBadge value={p?.analogy_strength} />
                      <span className="text-[11.5px] text-subtle">
                        / 100 · {rc?.n ?? 0} analogue{rc?.n === 1 ? "" : "s"} in the reference class
                      </span>
                    </span>
                  }
                />
                <OutputRow
                  label="Current evidence strength"
                  hint="Total weighted |log-LR| on both sides, scaled to 0-100"
                  value={
                    <span className="flex items-baseline gap-2">
                      <ScoreBadge value={p?.evidence_strength} />
                      <span className="text-[11.5px] text-subtle">/ 100 · {activeEvidence} active items</span>
                    </span>
                  }
                />
                <OutputRow
                  label="Evidence quality"
                  hint="Mean data quality of the active evidence"
                  value={
                    <span className="flex items-baseline gap-2">
                      <ScoreBadge value={p?.evidence_quality} />
                      <span className="text-[11.5px] text-subtle">/ 100</span>
                    </span>
                  }
                />
                <OutputRow
                  label="Contradictory evidence"
                  hint="Share of the weighted evidence that contradicts: Low < 20% · Moderate < 40% · High"
                  value={<ContradictoryChip value={p?.contradictory_evidence} />}
                />
                <OutputRow
                  label="Confidence in probability"
                  hint="High: ≥ 8 analogues, ≥ 8 evidence items, quality ≥ 70 · Medium: ≥ 5 and ≥ 5 · else Low"
                  value={<ConfidenceChip value={p?.confidence} />}
                />
                <OutputRow label="Next major confirmation signal" value={<div className="max-w-3xl">{ind?.next_confirmation_signal || <span className="text-muted">—</span>}</div>} />
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-4 py-2.5 text-[12.5px]">
            <div className="mono">
              prior log-odds <span className="font-medium">{signed(p?.log_odds_prior, 3)}</span> + evidence{" "}
              <span className={`font-medium ${signClass(p?.log_odds_evidence)}`}>{signed(p?.log_odds_evidence, 3)}</span> = posterior{" "}
              <span className="font-medium">{signed(p?.log_odds_posterior, 3)}</span>
              <span className="text-subtle"> → {num(p?.posterior, 1)}%</span>
            </div>
            {p?.note && <p className="mt-1 text-[12px] text-muted">{p.note}</p>}
          </div>
        </Section>

        <Section title="Formalized thesis" subtitle="Measurable restatement of the raw thesis" className="lg:col-span-2">
          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div>
              <KV label="Statement" value={f?.statement || "—"} />
              <KV label="Population" value={f?.population || "—"} />
              <KV label="Behaviour" value={f?.behavior || "—"} />
              <KV label="Horizon year" value={<span className="mono">{f?.horizon_year ?? "—"}</span>} />
              <KV label="Observable outcome" value={f?.observable_outcome || "—"} />
              <KV label="Measurable metric" value={f?.measurable_metric || "—"} />
            </div>
            <div>
              <div className="eyebrow mb-1.5">Raw statement</div>
              <blockquote className="border-l-2 border-line-strong pl-3 text-[13px] italic text-muted">{t.raw_statement || "—"}</blockquote>
            </div>
          </div>
        </Section>

        {sourceBullets.length > 0 && (
          <Section
            title="Source observations"
            subtitle={`${sourceBullets.length} long-term human-behaviour bullet${sourceBullets.length === 1 ? "" : "s"} from ${sourceDates.size} morning brief${sourceDates.size === 1 ? "" : "s"} · the observations this thesis consolidates`}
            className="lg:col-span-2"
          >
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {sourceBullets.map((b, i) => (
                <li key={`${b.date}-${i}`} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3">
                  <span className="mono text-subtle">{date(b.date)}</span>
                  <span className="leading-relaxed">{b.text}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Causal mechanism" subtitle="Why humans would do this · the nine parts the analogues are matched on" className="lg:col-span-2">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {MECHANISM_KEYS.map((k) => (
              <div key={k} className="rounded border border-line bg-surface-2 px-3 py-2">
                <div className="eyebrow mb-1">{MECHANISM_LABELS[k] ?? k}</div>
                <p className="text-[12.5px] leading-relaxed">{t.mechanism?.[k] || <span className="text-muted">—</span>}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Historical analogues"
          subtitle={
            <>
              {t.analogues?.length ?? 0} transitions sharing the mechanism · expand a row for the eight similarity dimensions · rows below {SIMILARITY_CUTOFF} are dimmed and
              excluded from the base rate
            </>
          }
          className="lg:col-span-2"
          flush
        >
          <AnaloguesTable rows={t.analogues ?? []} />
          <div className="border-t border-line px-4 py-2.5 text-[12.5px]">
            <div>
              <span className="eyebrow mr-2">Reference class</span>
              <span className="font-medium">{rc?.n ?? 0}</span> analogue{rc?.n === 1 ? "" : "s"} with similarity ≥ {SIMILARITY_CUTOFF} · occurred in{" "}
              <span className="font-medium">{rc?.occurred ?? 0}</span> · base rate (Laplace) = <span className="font-medium">{pct(rc?.base_rate, 1)}</span> = prior
            </div>
            {rc?.description && <p className="mt-1 text-muted">{rc.description}</p>}
            {rc?.caveats && (
              <p className="mt-1 text-muted">
                <span className="text-warn">Caveats:</span> {rc.caveats}
              </p>
            )}
          </div>
        </Section>

        <Section
          title="Evidence"
          subtitle={`${activeEvidence} active of ${t.evidence?.length ?? 0} items · each weighted by quality × independence · retired items are struck through`}
          className="lg:col-span-2"
          flush
        >
          <EvidenceTable rows={t.evidence ?? []} />
        </Section>

        <Section title="Stage of adoption" subtitle="Where the transition sits on the historical pathway">
          <div className="flex flex-wrap items-center gap-2">
            <AdoptionStageChip stage={st?.current_stage} className="border-accent bg-accent-soft text-accent font-medium" />
          </div>
          {st?.historical_pathway_position && <p className="mt-2 text-[13px] leading-relaxed">{st.historical_pathway_position}</p>}
          <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <div className="eyebrow mb-1">Prerequisites met</div>
              <Bullets items={st?.prerequisites_met} empty="None recorded." marker="✓" markerCls="text-pos" />
            </div>
            <div>
              <div className="eyebrow mb-1">Prerequisites missing</div>
              <Bullets items={st?.prerequisites_missing} empty="None missing." marker="○" markerCls="text-warn" />
            </div>
          </div>
        </Section>

        <Section title="Scenarios" subtitle="Bull / base / bear · weights normalised to 100%">
          <div className="flex flex-col gap-3">
            {SCENARIO_KEYS.map((k) => {
              const sc = t.scenarios?.[k];
              const prob = sc?.probability ?? null;
              return (
                <div key={k}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="font-medium">{SCENARIO_LABELS[k]}</span>
                    <span className="num font-medium">{num(prob, 0)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-sm bg-[var(--meter-track)]">
                    <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, prob ?? 0))}%` }} />
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted">{sc?.description || "—"}</p>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Indicators" subtitle="What to watch · the next confirmation signal is what the monthly review looks for first" className="lg:col-span-2">
          <div className="mb-3 rounded border border-accent bg-accent-soft px-3 py-2 text-[13px]">
            <span className="eyebrow mr-2 text-accent">Next confirmation signal</span>
            {ind?.next_confirmation_signal || <span className="text-muted">—</span>}
          </div>
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-3">
            <div>
              <div className="eyebrow mb-1">Supporting</div>
              <Bullets items={ind?.supporting} empty="None listed." markerCls="text-pos" />
            </div>
            <div>
              <div className="eyebrow mb-1">Contradictory</div>
              <Bullets items={ind?.contradictory} empty="None listed." markerCls="text-neg" />
            </div>
            <div>
              <div className="eyebrow mb-1">Biggest variables</div>
              <Bullets items={ind?.biggest_variables} empty="None listed." />
            </div>
          </div>
        </Section>

        <Section
          title="Value pools"
          subtitle="Where economic value accumulates if the behaviour happens · universe tickers only"
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Emerging need</th>
                  <th>Opportunity</th>
                  <th>Becomes</th>
                  <th>Tickers</th>
                </tr>
              </thead>
              <tbody>
                {(t.value_pools ?? []).map((v, i) => (
                  <tr key={`${v.layer}-${i}`} className="align-top">
                    <td className="font-medium">
                      <div className="max-w-40 whitespace-normal">{v.layer}</div>
                    </td>
                    <td className="text-[12.5px] text-muted">
                      <div className="max-w-xs whitespace-normal">{v.emerging_need}</div>
                    </td>
                    <td className="text-[12.5px]">
                      <div className="max-w-md whitespace-normal">{v.opportunity}</div>
                    </td>
                    <td>
                      <BecomesChip value={v.becomes} />
                    </td>
                    <td>
                      <div className="flex max-w-48 flex-wrap gap-1 whitespace-normal">
                        {v.tickers?.length ? (
                          v.tickers.map((tk) => (
                            <Link key={tk} href={`/companies/${tk}`} className="chip mono hover:text-accent">
                              {tk}
                            </Link>
                          ))
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!t.value_pools?.length && (
                  <tr>
                    <td colSpan={5} className="text-muted">
                      No value pools recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="grid gap-x-8 gap-y-3 border-t border-line px-4 py-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div>
              <div className="eyebrow mb-1">Second-order thesis</div>
              <p className="text-[13px] leading-relaxed">{t.second_order_thesis || <span className="text-muted">—</span>}</p>
            </div>
            <div>
              <div className="eyebrow mb-1">Losers</div>
              <Bullets items={t.losers} empty="None named." markerCls="text-neg" />
            </div>
          </div>
        </Section>

        <Section
          title="Probability history"
          subtitle={`${history.length} observation${history.length === 1 ? "" : "s"} · created ${date(t.created)} · ${t.updates?.length ?? 0} monthly update${t.updates?.length === 1 ? "" : "s"}`}
          className="lg:col-span-2"
        >
          <ProbabilityHistoryChart history={history} prior={p?.prior} rangeLow={p?.range_low} rangeHigh={p?.range_high} />
        </Section>

        <Section title="Updates log" subtitle="Monthly reviews, newest first · what changed, and whether the new evidence argued for moving the probability" className="lg:col-span-2" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Before</th>
                  <th></th>
                  <th className="num">After</th>
                  <th className="num">Δ</th>
                  <th className="num">New</th>
                  <th className="num">Retired</th>
                  <th>What changed</th>
                  <th>Should change mind?</th>
                </tr>
              </thead>
              <tbody>
                {updates.map((u, i) => {
                  const delta = u.posterior_after !== null && u.posterior_before !== null ? u.posterior_after - u.posterior_before : null;
                  return (
                    <tr key={`${u.date}-${i}`} className="align-top">
                      <td className="mono">{date(u.date)}</td>
                      <td className="num text-muted">{num(u.posterior_before, 1)}%</td>
                      <td className="text-subtle">→</td>
                      <td className="num font-medium">{num(u.posterior_after, 1)}%</td>
                      <td className={`num ${signClass(delta)}`}>{signed(delta, 1)}</td>
                      <td className="num">{u.new_evidence ?? 0}</td>
                      <td className="num text-muted">{u.retired ?? 0}</td>
                      <td>
                        <div className="max-w-md whitespace-normal text-[12.5px]">
                          <Bullets items={u.what_changed} empty="Nothing material." />
                        </div>
                      </td>
                      <td className="text-[12.5px] text-muted">
                        <div className="max-w-md whitespace-normal">{u.should_change_mind || "—"}</div>
                      </td>
                    </tr>
                  );
                })}
                {!updates.length && (
                  <tr>
                    <td colSpan={9} className="text-muted">
                      No monthly updates yet — run &ldquo;Monthly review: what changed?&rdquo; above, or wait for the scheduled review.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
