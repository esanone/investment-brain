import Link from "next/link";
import { api } from "@/lib/api";
import { IS_STATIC } from "@/lib/static";
import type { Theme } from "@/lib/types";
import { ATTENTION_SOURCE_LABELS, num, ptsSigned, signed, signClass, weight } from "@/lib/format";
import { AttentionFlags } from "@/components/AttentionFlags";
import { EmptyState } from "@/components/EmptyState";
import { Meter } from "@/components/Meter";
import { PageHeader } from "@/components/PageHeader";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Section } from "@/components/Section";

export * from "@/lib/segment-config-dynamic-route";

/** Static export: one page per theme in the exported snapshot (public/data/api/themes.json). Live mode renders on demand. */
export async function generateStaticParams(): Promise<{ id: string }[]> {
  if (!IS_STATIC) return [];
  const res = await api.themes();
  return res.ok ? res.data.map((t) => ({ id: t.id })) : [];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Theme · ${id}` };
}

function KV({ label, value, cls = "" }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[13px] last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className={`font-medium ${cls}`}>{value}</span>
    </div>
  );
}

function ChildRow({ t, depth }: { t: Theme; depth: number }) {
  return (
    <>
      <tr>
        <td style={{ paddingLeft: 8 + depth * 16 }}>
          {t.star && <span className="mr-1.5 text-warn">★</span>}
          {t.name}
          <span className="ml-2 mono text-subtle">{t.id}</span>
        </td>
        <td className="num">{num(t.trend, 0)}</td>
        <td className="num">{num(t.pricing, 0)}</td>
        <td className={`num font-medium ${signClass(t.gap)}`}>{signed(t.gap, 0)}</td>
        <td className="num text-muted">{num(t.growth, 0)}</td>
        <td className="num text-muted">{t.n_companies}</td>
        <td className="text-muted">
          {(t.members ?? []).slice(0, 6).map((m, i) => (
            <span key={m.ticker}>
              {i > 0 && ", "}
              <Link href={`/companies/${m.ticker}`}>{m.ticker}</Link>
            </span>
          ))}
        </td>
      </tr>
      {(t.children ?? []).map((c) => (
        <ChildRow key={c.id} t={c} depth={depth + 1} />
      ))}
    </>
  );
}

export default async function ThemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await api.theme(id);
  if (!res.ok) {
    return (
      <>
        <PageHeader title={`Theme · ${id}`} />
        <EmptyState title={res.status === 404 ? `Theme "${id}" not found in the latest snapshot` : "No data yet"} message={res.message} />
      </>
    );
  }
  const t = res.data;
  const members = t.members ?? [];
  const att = t.attention ?? null;
  const appRanks = [...(att?.app_ranks ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  return (
    <>
      <PageHeader
        title={
          <>
            {t.star && <span className="mr-2 text-warn">★</span>}
            {t.name}
          </>
        }
        subtitle={t.description}
        meta={
          <>
            <Link href="/themes" className="hover:text-accent">themes</Link> / {t.id} · horizon {t.horizon_years ?? "—"} years · {t.n_companies} companies
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <Section title="Trend vs pricing" className="lg:col-span-2">
          <div className="flex flex-col gap-3">
            <Meter label="Trend (reality)" value={t.trend} hint={<>company trend {num(t.company_trend, 0)} · related-ETF flow {num(t.etf_flow, 0)} · growth {num(t.growth, 0)}</>} />
            <Meter label="Market pricing" value={t.pricing} />
            <div className="flex items-baseline justify-between border-t border-line pt-2 text-[13px]">
              <span>Expectations gap</span>
              <span className={`text-[16px] font-semibold ${signClass(t.gap)}`}>{signed(t.gap, 0)}</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="eyebrow mb-1.5">Human needs</div>
            <div className="flex flex-wrap gap-1.5">
              {(t.human_needs ?? []).length ? t.human_needs.map((n) => <span key={n} className="chip">{n}</span>) : <span className="text-muted">—</span>}
            </div>
          </div>
          <div className="mt-3">
            <div className="eyebrow mb-1.5">Related ETFs</div>
            <div className="flex flex-wrap gap-1.5">
              {(t.related_etfs ?? []).length ? t.related_etfs.map((e) => <span key={e} className="chip mono">{e}</span>) : <span className="text-muted">—</span>}
            </div>
          </div>
        </Section>

        <Section title="Constraint chain" subtitle="Trend → Constraint → Required solution" className="lg:col-span-3">
          {(t.constraints ?? []).length ? (
            <div className="flex flex-col gap-3">
              {t.constraints.map((c, i) => (
                <div key={i} className="grid gap-2 text-[13px] sm:grid-cols-3">
                  <div className="rounded border border-line bg-surface-2 px-3 py-2">
                    <div className="eyebrow mb-1">Trend</div>
                    {c.trend ?? "—"}
                  </div>
                  <div className="relative rounded border border-line bg-surface-2 px-3 py-2">
                    <span className="absolute -left-3 top-1/2 hidden -translate-y-1/2 text-subtle sm:block">→</span>
                    <div className="eyebrow mb-1">Constraint</div>
                    {c.constraint ?? "—"}
                  </div>
                  <div className="relative rounded border border-line bg-surface-2 px-3 py-2">
                    <span className="absolute -left-3 top-1/2 hidden -translate-y-1/2 text-subtle sm:block">→</span>
                    <div className="eyebrow mb-1">Required solution</div>
                    {c.solution ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-muted">No constraint chain defined for this theme.</div>
          )}
        </Section>

        {att && (
          <Section
            title="Attention"
            subtitle={
              <Link href="/attention" className="hover:text-accent">
                Wikipedia, App Store, GitHub{att.youtube ? ", YouTube" : ""} and search autocomplete · {att.breadth} of {Object.keys(att.sources ?? {}).length} sources contributing
              </Link>
            }
            className="lg:col-span-5"
            actions={<AttentionFlags notPriced={att.not_priced} />}
          >
            <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
              <div>
                <Meter label="Attention" value={att.attention} hint={<>blend of per-source scores · breadth {att.breadth}</>} />
                <div className="mt-3">
                  <div className="eyebrow mb-1.5">Per-source scores</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(att.sources ?? {}).map(([k, v]) => (
                      <span key={k} className="chip">
                        {ATTENTION_SOURCE_LABELS[k] ?? k} <span className="font-medium text-ink">{num(v, 0)}</span>
                      </span>
                    ))}
                    {!Object.keys(att.sources ?? {}).length && <span className="text-muted">—</span>}
                  </div>
                </div>
                <div className="mt-3">
                  <div className="eyebrow mb-1.5">Rising queries</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(att.rising_queries ?? []).length ? att.rising_queries.map((q) => <span key={q} className="chip">{q}</span>) : <span className="text-muted">—</span>}
                  </div>
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1">Wikipedia · {(att.wiki_articles ?? []).length} articles</div>
                <KV label="7d avg pageviews" value={num(att.wiki_7d, 0)} />
                <KV label="vs 28d" value={ptsSigned(att.wiki_vs_28d_pct)} cls={signClass(att.wiki_vs_28d_pct)} />
                <KV label="vs 1y" value={ptsSigned(att.wiki_vs_1y_pct)} cls={signClass(att.wiki_vs_1y_pct)} />
                <KV label="z vs own history" value={signed(att.wiki_z, 2)} cls={signClass(att.wiki_z)} />
                {(att.wiki_articles ?? []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {att.wiki_articles.map((w) => (
                      <span key={w} className="chip mono">{w}</span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="eyebrow mb-1">Apps · GitHub{att.youtube ? " · YouTube" : ""}</div>
                {appRanks.length ? (
                  appRanks.map((a) => (
                    <KV key={a.name} label={a.name} value={a.rank === null ? <span className="text-subtle">not in top-100</span> : `#${a.rank}`} />
                  ))
                ) : (
                  <KV label="Apps in top-100" value="—" />
                )}
                <KV label="GitHub repos" value={num(att.gh_repos, 0)} />
                {att.youtube && (
                  <>
                    <KV label="YouTube videos · 7d" value={num(att.youtube.last7, 0)} />
                    <KV label="YouTube vs 28d" value={ptsSigned(att.youtube.vs_28d_pct)} cls={signClass(att.youtube.vs_28d_pct)} />
                  </>
                )}
              </div>
            </div>
          </Section>
        )}

        {(t.children ?? []).length > 0 && (
          <Section title="Sub-themes" subtitle={`${t.children.length} children`} className="lg:col-span-5" flush>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Sub-theme</th>
                    <th className="num">Trend</th>
                    <th className="num">Pricing</th>
                    <th className="num">Gap</th>
                    <th className="num">Growth</th>
                    <th className="num">Cos.</th>
                    <th>Members</th>
                  </tr>
                </thead>
                <tbody>
                  {t.children.map((c) => (
                    <ChildRow key={c.id} t={c} depth={0} />
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <Section title="Member companies" subtitle="Sorted by effective exposure (weight × order decay)" className="lg:col-span-5" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th className="num">Weight</th>
                  <th className="num">Order</th>
                  <th className="num">Reality</th>
                  <th className="num">Pricing</th>
                  <th className="num">Gap</th>
                  <th className="num">Growth</th>
                  <th className="num">Quality</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const gap = m.reality === null || m.pricing === null ? null : m.reality - m.pricing;
                  return (
                    <tr key={m.ticker}>
                      <td>
                        <Link href={`/companies/${m.ticker}`} className="font-medium">{m.ticker}</Link>
                      </td>
                      <td className="text-muted">
                        <Link href={`/companies/${m.ticker}`}>{m.name}</Link>
                      </td>
                      <td className="num">{weight(m.weight)}</td>
                      <td className="num text-muted">{m.order}</td>
                      <td className="num"><ScoreBadge value={m.reality} /></td>
                      <td className="num"><ScoreBadge value={m.pricing} /></td>
                      <td className={`num ${signClass(gap)}`}>{signed(gap, 0)}</td>
                      <td className="num"><ScoreBadge value={m.growth} /></td>
                      <td className="num"><ScoreBadge value={m.quality} /></td>
                      <td className="num"><ScoreBadge value={m.value} /></td>
                    </tr>
                  );
                })}
                {!members.length && (
                  <tr>
                    <td colSpan={10} className="text-muted">No scored member companies in this run.</td>
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
