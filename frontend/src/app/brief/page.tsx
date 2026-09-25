import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import type { BriefAction, SignalDirection } from "@/lib/types";
import { EPISTEMIC_LABELS, date, num, pct } from "@/lib/format";
import { BriefRunButton } from "@/components/BriefRunButton";
import { DirectionChip } from "@/components/DirectionChip";
import { EmptyState } from "@/components/EmptyState";
import { Meter } from "@/components/Meter";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Morning brief" };

const SIGNAL_CLASS: Record<SignalDirection, string> = {
  bullish: "border-pos bg-pos-soft text-pos",
  bearish: "border-neg bg-neg-soft text-neg",
  neutral: "",
};

const ACTION_CLASS: Record<BriefAction, string> = {
  add: "border-pos bg-pos-soft text-pos",
  trim: "border-warn bg-warn-soft text-warn",
  review: "border-warn bg-warn-soft text-warn",
  hold: "",
};

const KIND_CLASS: Record<string, string> = {
  observed_fact: "border-pos bg-pos-soft text-pos",
  consensus_expectation: "",
  ai_inference: "border-accent bg-accent-soft text-accent",
  speculative_hypothesis: "border-warn bg-warn-soft text-warn",
};

/** Fraction or 0-100 -> 0-100 for the Meter. */
function toScore(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return v <= 1 ? v * 100 : v;
}

function fmtTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SignalChip({ direction }: { direction: SignalDirection }) {
  return <span className={`chip ${SIGNAL_CLASS[direction] ?? ""}`}>{direction}</span>;
}

function Bullets({ items, empty = "Nothing flagged." }: { items: (string | null | undefined)[] | null | undefined; empty?: string }) {
  const list = (items ?? []).filter((x): x is string => !!x);
  if (!list.length) return <div className="text-[12.5px] text-muted">{empty}</div>;
  return (
    <ul className="flex flex-col gap-1 text-[13px]">
      {list.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-subtle">·</span>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

function StrengthBar({ value }: { value: number | null | undefined }) {
  const v = toScore(value) ?? 0;
  return (
    <div className="h-1.5 w-24 rounded-sm bg-[var(--meter-track)]">
      <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
    </div>
  );
}

export default async function BriefPage() {
  const [res, histRes, health] = await Promise.all([api.brief(), api.briefHistory(), api.health()]);
  const running = health.ok ? Boolean(health.data.running_brief) : false;
  const history = histRes.ok ? histRes.data : [];

  if (!res.ok) {
    return (
      <>
        <PageHeader title="Morning brief" actions={<BriefRunButton initialRunning={running} />} />
        {res.status === 404 ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
            <h2 className="text-[15px] font-semibold">No brief yet</h2>
            <p className="mt-1 text-[13px] text-muted">
              Generate the first one with the button above; it pulls the headline feeds and, with an LLM key configured, writes the thesis.
            </p>
            <p className="mono mt-2 text-[12px] text-subtle">{res.message}</p>
          </div>
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }

  const b = res.data;
  const llm = b.llm;
  const thesis = llm?.market_thesis;
  const themeSignals = [...(llm?.theme_signals ?? [])].sort((x, y) => (y.strength ?? 0) - (x.strength ?? 0));
  const mentions = [...(b.ticker_mentions ?? [])].sort((x, y) => y.n - x.n);
  const narrative = b.narrative?.by_theme ?? {};
  const okSources = (b.sources ?? []).filter((s) => s.ok).length;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span>Morning brief</span>
            {thesis && <DirectionChip direction={thesis.direction} />}
          </span>
        }
        subtitle={
          <>
            {b.n_headlines ?? b.headlines?.length ?? 0} headlines · {b.clusters?.length ?? 0} themes · {okSources}/{b.sources?.length ?? 0} sources ok · llm{" "}
            {b.llm_provider ?? "off"}
          </>
        }
        meta={
          <>
            brief {b.brief_id} · as of {date(b.as_of)} · generated {fmtTime(b.generated_at)}
          </>
        }
        actions={<BriefRunButton initialRunning={running} />}
      />

      {!llm && (
        <div className="mb-4 rounded border border-line bg-surface-2 px-4 py-2 text-[12.5px] text-muted">
          No LLM key configured — headlines only; add <span className="mono">ANTHROPIC_API_KEY</span> to <span className="mono">backend/.env</span> for the
          thesis.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {llm && (
          <>
            <Section title="Summary" subtitle={<span className="text-accent">LLM · grounded in today&apos;s headlines only</span>} className="lg:col-span-2">
              <p className="text-[13.5px] leading-relaxed">{llm.summary}</p>
            </Section>

            {thesis && (
              <Section
                title="Market thesis"
                subtitle={
                  <span className="flex items-center gap-2">
                    Direction <DirectionChip direction={thesis.direction} />
                  </span>
                }
                className="lg:col-span-2"
                actions={
                  <div className="w-40">
                    <Meter label={<span className="text-muted">Confidence</span>} value={toScore(thesis.confidence)} size="sm" />
                  </div>
                }
              >
                <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
                  <div>
                    <div className="eyebrow mb-1.5">Short term</div>
                    <p className="text-[13px] leading-relaxed">{thesis.short_term || <span className="text-muted">—</span>}</p>
                  </div>
                  <div>
                    <div className="eyebrow mb-1.5">Medium term</div>
                    <p className="text-[13px] leading-relaxed">{thesis.medium_term || <span className="text-muted">—</span>}</p>
                  </div>
                  <div>
                    <div className="eyebrow mb-1.5">Long term</div>
                    <p className="text-[13px] leading-relaxed">{thesis.long_term || <span className="text-muted">—</span>}</p>
                  </div>
                </div>
              </Section>
            )}

            <Section title="Human behaviour" subtitle="How people are likely to act on what they read" className="lg:col-span-2">
              <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
                <div>
                  <div className="eyebrow mb-1.5">Short term</div>
                  <Bullets items={llm.human_behavior?.short_term} />
                </div>
                <div>
                  <div className="eyebrow mb-1.5">Long term</div>
                  <Bullets items={llm.human_behavior?.long_term} />
                </div>
              </div>
            </Section>

            <Section title="Claims" subtitle="Every statement tagged by how it is known" className="lg:col-span-2" flush>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Claim</th>
                      <th>Horizon</th>
                      <th>Kind</th>
                      <th className="num">Conf.</th>
                      <th>Beneficiaries</th>
                      <th>Risks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(llm.claims ?? []).map((c, i) => (
                      <tr key={i} className="align-top">
                        <td className="max-w-md whitespace-normal">{c.claim}</td>
                        <td className="text-muted">{c.horizon || "—"}</td>
                        <td>
                          <span className={`chip ${KIND_CLASS[c.kind] ?? ""}`}>{EPISTEMIC_LABELS[c.kind] ?? c.kind}</span>
                        </td>
                        <td className="num">{pct(c.confidence <= 1 ? c.confidence : c.confidence / 100, 0)}</td>
                        <td className="max-w-56 whitespace-normal text-[12.5px] text-muted">{c.beneficiaries?.length ? c.beneficiaries.join(", ") : "—"}</td>
                        <td className="max-w-56 whitespace-normal text-[12.5px] text-muted">{c.risks?.length ? c.risks.join(", ") : "—"}</td>
                      </tr>
                    ))}
                    {!llm.claims?.length && (
                      <tr>
                        <td colSpan={6} className="text-muted">No claims.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Theme signals" subtitle="Direction and strength read from today's flow · narrative = 7-day score" className="lg:col-span-2" flush>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Theme</th>
                      <th>Direction</th>
                      <th>Strength</th>
                      <th className="num">Narrative</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {themeSignals.map((t, i) => (
                      <tr key={`${t.theme_id}-${i}`} className="align-top">
                        <td>
                          <Link href={`/themes/${t.theme_id}`} className="font-medium">
                            {t.theme}
                          </Link>
                        </td>
                        <td>
                          <SignalChip direction={t.direction} />
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <StrengthBar value={t.strength} />
                            <span className="text-[11.5px] text-muted">{num(toScore(t.strength), 0)}</span>
                          </div>
                        </td>
                        <td className="num text-muted">{narrative[t.theme_id] === undefined ? "—" : num(narrative[t.theme_id], 0)}</td>
                        <td className="max-w-lg whitespace-normal text-[12.5px] text-muted">{t.evidence}</td>
                      </tr>
                    ))}
                    {!themeSignals.length && (
                      <tr>
                        <td colSpan={5} className="text-muted">No theme signals.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Ticker signals" flush>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Direction</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(llm.ticker_signals ?? []).map((t, i) => (
                      <tr key={`${t.ticker}-${i}`} className="align-top">
                        <td>
                          <Link href={`/companies/${t.ticker}`} className="mono font-medium">
                            {t.ticker}
                          </Link>
                        </td>
                        <td>
                          <SignalChip direction={t.direction} />
                        </td>
                        <td className="max-w-md whitespace-normal text-[12.5px] text-muted">{t.evidence}</td>
                      </tr>
                    ))}
                    {!llm.ticker_signals?.length && (
                      <tr>
                        <td colSpan={3} className="text-muted">No ticker signals.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Portfolio implications" subtitle="For names in the model portfolio" flush>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Action</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(llm.portfolio_implications ?? []).map((p, i) => (
                      <tr key={`${p.ticker}-${i}`} className="align-top">
                        <td>
                          <Link href={`/companies/${p.ticker}`} className="mono font-medium">
                            {p.ticker}
                          </Link>
                        </td>
                        <td>
                          <span className={`chip font-medium ${ACTION_CLASS[p.action] ?? ""}`}>{p.action}</span>
                        </td>
                        <td className="max-w-md whitespace-normal text-[12.5px] text-muted">{p.why}</td>
                      </tr>
                    ))}
                    {!llm.portfolio_implications?.length && (
                      <tr>
                        <td colSpan={3} className="text-muted">Nothing to act on.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Watch today">
              <Bullets items={llm.watch_today} empty="Nothing on watch." />
            </Section>

            <Section title="What changed since yesterday">
              <Bullets items={llm.what_changed_since_yesterday} empty="No prior brief to compare." />
            </Section>
          </>
        )}

        {/* Always shown: raw material */}
        <Section title="Clusters by theme" subtitle={`${b.clusters?.length ?? 0} themes · expand for headlines`} className="lg:col-span-2" flush>
          {b.clusters?.length ? (
            <div className="divide-y divide-line">
              {b.clusters.map((c) => (
                <details key={c.theme_id} className="group">
                  <summary className="flex cursor-pointer items-center gap-3 px-4 py-2 text-[13px] hover:bg-surface-2">
                    <span className="w-3 text-subtle transition-transform group-open:rotate-90">›</span>
                    <Link href={`/themes/${c.theme_id}`} className="font-medium hover:text-accent">
                      {c.theme}
                    </Link>
                    <span className="chip">{c.n}</span>
                    {narrative[c.theme_id] !== undefined && (
                      <span className="text-[11.5px] text-subtle">narrative {num(narrative[c.theme_id], 0)}</span>
                    )}
                  </summary>
                  <ul className="flex flex-col gap-1 bg-surface-2 px-4 py-2 pl-10 text-[12.5px]">
                    {c.headlines.map((h, i) => (
                      <li key={i} className="flex gap-2">
                        <a href={h.url} target="_blank" rel="noopener noreferrer" className="min-w-0 hover:text-accent">
                          {h.title}
                        </a>
                        <span className="shrink-0 text-[11px] text-subtle">{h.source}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ) : (
            <div className="px-4 py-3 text-[12.5px] text-muted">No headlines matched a theme.</div>
          )}
        </Section>

        <Section title="Ticker mentions" subtitle="Count of headlines naming each ticker · portfolio names highlighted" className="lg:col-span-2">
          {mentions.length ? (
            <div className="flex flex-wrap gap-1.5">
              {mentions.map((m) => (
                <Link
                  key={m.ticker}
                  href={`/companies/${m.ticker}`}
                  title={m.name}
                  className={`chip hover:text-accent ${m.in_portfolio ? "border-accent bg-accent-soft text-accent" : ""}`}
                >
                  <span className={`mono font-medium ${m.in_portfolio ? "" : "text-ink"}`}>{m.ticker}</span> {m.n}
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-muted">No tickers mentioned.</div>
          )}
        </Section>

        <Section title="Headlines" subtitle={`showing ${b.headlines?.length ?? 0} of ${b.n_headlines ?? b.headlines?.length ?? 0} deduped · newest first`} className="lg:col-span-2" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Source</th>
                  <th>Time</th>
                  <th>Tickers</th>
                </tr>
              </thead>
              <tbody>
                {(b.headlines ?? []).map((h, i) => (
                  <tr key={`${h.url}-${i}`}>
                    <td className="max-w-2xl whitespace-normal">
                      <a href={h.url} target="_blank" rel="noopener noreferrer">
                        {h.title}
                      </a>
                    </td>
                    <td className="text-muted">{h.source}</td>
                    <td className="mono text-subtle">{fmtTime(h.published)}</td>
                    <td className="mono text-[11.5px] text-muted">{h.tickers?.length ? h.tickers.join(" ") : ""}</td>
                  </tr>
                ))}
                {!b.headlines?.length && (
                  <tr>
                    <td colSpan={4} className="text-muted">No headlines.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="History" subtitle={histRes.ok ? `${history.length} briefs · newest first` : histRes.message} className="lg:col-span-2" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>As of</th>
                  <th>Generated</th>
                  <th className="num">Headlines</th>
                  <th>Direction</th>
                  <th>LLM</th>
                  <th>Brief</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.brief_id} className={h.brief_id === b.brief_id ? "font-medium" : ""}>
                    <td className="mono">{date(h.as_of)}</td>
                    <td className="text-muted">{fmtTime(h.generated_at)}</td>
                    <td className="num">{h.n_headlines}</td>
                    <td>
                      <DirectionChip direction={h.direction} />
                    </td>
                    <td className="text-muted">{h.has_llm ? "yes" : "—"}</td>
                    <td className="mono text-subtle">{h.brief_id}</td>
                  </tr>
                ))}
                {!history.length && (
                  <tr>
                    <td colSpan={6} className="text-muted">No brief history yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <footer className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[11.5px] text-subtle">
        {(b.sources ?? []).map((s) => (
          <span key={s.name} title={s.url}>
            {s.name} {s.n}
            <span className={`ml-1 ${s.ok ? "text-pos" : "text-neg"}`}>{s.ok ? "ok" : "failed"}</span>
          </span>
        ))}
        {!b.sources?.length && <span>No sources recorded.</span>}
      </footer>
    </>
  );
}
