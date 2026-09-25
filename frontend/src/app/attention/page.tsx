import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import type { AttentionEntity, CompanyAttention, ThemeAttention } from "@/lib/types";
import { isCompanyAttention } from "@/lib/types";
import { ATTENTION_SOURCE_LABELS, date, num, pct, ptsSigned, signClass } from "@/lib/format";
import { AttentionCompaniesTable } from "@/components/AttentionCompaniesTable";
import { AttentionFlags } from "@/components/AttentionFlags";
import { AttentionRunButton } from "@/components/AttentionRunButton";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Section } from "@/components/Section";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Attention" };

function fmtTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function entityHref(e: AttentionEntity): string {
  return isCompanyAttention(e) ? `/companies/${e.ticker}` : `/themes/${e.theme_id}`;
}

function entityKey(e: AttentionEntity): string {
  return isCompanyAttention(e) ? `c-${e.ticker}` : `t-${e.theme_id}`;
}

/** "ChatGPT #1, Claude #7" — apps without a rank are listed after the ranked ones as "name —". */
function appRanks(t: ThemeAttention): string {
  const ranks = [...(t.app_ranks ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  if (!ranks.length) return "—";
  return ranks.map((a) => `${a.name} ${a.rank === null ? "—" : `#${a.rank}`}`).join(", ");
}

function Chips({ items, max = 6 }: { items: string[] | null | undefined; max?: number }) {
  const list = (items ?? []).filter(Boolean).slice(0, max);
  if (!list.length) return <span className="text-subtle">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map((q) => (
        <span key={q} className="chip">
          {q}
        </span>
      ))}
    </span>
  );
}

function MoverList({ rows, empty }: { rows: AttentionEntity[]; empty: string }) {
  if (!rows.length) return <div className="text-[12.5px] text-muted">{empty}</div>;
  return (
    <ul className="flex flex-col gap-1 text-[12.5px]">
      {rows.map((e) => (
        <li key={entityKey(e)} className="flex items-center gap-2">
          <Link href={entityHref(e)} className="min-w-0 flex-1 truncate hover:text-accent">
            {isCompanyAttention(e) ? (
              <>
                <span className="mono font-medium">{e.ticker}</span> <span className="text-muted">{e.name}</span>
              </>
            ) : (
              e.name
            )}
          </Link>
          <ScoreBadge value={e.attention} />
          <span className={`w-14 shrink-0 text-right ${signClass(e.wiki_vs_28d_pct)}`}>{ptsSigned(e.wiki_vs_28d_pct, 0)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function AttentionPage() {
  const [res, health] = await Promise.all([api.attention(), api.health()]);
  const running = health.ok ? Boolean(health.data.running_attention) : false;

  if (!res.ok) {
    return (
      <>
        <PageHeader title="Attention" actions={<AttentionRunButton initialRunning={running} />} />
        {res.status === 404 ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
            <h2 className="text-[15px] font-semibold">No attention snapshot yet</h2>
            <p className="mt-1 text-[13px] text-muted">
              Refresh it with the button above; it pulls Wikipedia pageviews, Stocktwits, the App Store chart, GitHub topics and search
              autocomplete for every company and theme. The first run has no history, so scores fill in over the following weeks.
            </p>
            <p className="mono mt-2 text-[12px] text-subtle">{res.message}</p>
          </div>
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }

  const a = res.data;
  const sources = Object.entries(a.sources ?? {});
  const okSources = sources.filter(([, s]) => s.ok).length;
  const themes = [...(a.themes ?? [])].sort((x, y) => (y.attention ?? -1) - (x.attention ?? -1));
  const notPriced = a.movers?.not_priced ?? [];
  const crowded: CompanyAttention[] = a.movers?.crowded ?? [];
  const companiesUp = a.movers?.companies_up ?? [];
  const companiesDown = a.movers?.companies_down ?? [];
  const themesUp = a.movers?.themes_up ?? [];

  return (
    <>
      <PageHeader
        title="Attention"
        subtitle={a.method}
        meta={
          <>
            as of {date(a.as_of)} · generated {fmtTime(a.generated_at)} · {a.companies?.length ?? 0} companies · {themes.length} themes ·{" "}
            {okSources}/{sources.length} sources ok
          </>
        }
        actions={<AttentionRunButton initialRunning={running} />}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {sources.map(([name, s]) => (
          <span key={name} className={`chip ${s.ok ? "" : "border-neg bg-neg-soft text-neg"}`} title={`weight ${num(a.weights?.[name], 2)}`}>
            <span className={s.ok ? "text-ink" : ""}>{ATTENTION_SOURCE_LABELS[name] ?? name}</span> {s.ok ? "ok" : "failed"} · {s.n}
          </span>
        ))}
        {!sources.length && <span className="text-[12.5px] text-muted">No sources recorded.</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* NOT YET PRICED */}
        <Section
          title="Not yet priced"
          subtitle="Attention ≥ 62, pricing ≤ 45 and rising vs the prior 28 days · early interest the market has not caught up with"
          className="lg:col-span-2"
          flush
        >
          {notPriced.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Kind</th>
                    <th className="num">Attention</th>
                    <th className="num">Pricing</th>
                    <th className="num">Wiki vs 28d</th>
                    <th className="num">Breadth</th>
                  </tr>
                </thead>
                <tbody>
                  {notPriced.map((e) => (
                    <tr key={entityKey(e)}>
                      <td>
                        <Link href={entityHref(e)} className="font-medium">
                          {isCompanyAttention(e) ? (
                            <>
                              <span className="mono">{e.ticker}</span> <span className="font-normal text-muted">{e.name}</span>
                            </>
                          ) : (
                            e.name
                          )}
                        </Link>
                      </td>
                      <td className="text-muted">{isCompanyAttention(e) ? "company" : "theme"}</td>
                      <td className="num"><ScoreBadge value={e.attention} /></td>
                      <td className="num"><ScoreBadge value={e.pricing} /></td>
                      <td className={`num ${signClass(e.wiki_vs_28d_pct)}`}>{ptsSigned(e.wiki_vs_28d_pct, 0)}</td>
                      <td className="num text-muted">{e.breadth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-3 text-[12.5px] text-muted">No entities meet the not-priced condition today</div>
          )}
        </Section>

        {/* CROWDED */}
        <Section
          title="Crowded"
          subtitle="Attention ≥ 80 with price momentum ≥ 80 · late, consensus interest"
          className="lg:col-span-2 border-neg/40"
          flush
        >
          {crowded.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th className="num">Attention</th>
                    <th className="num">Price momentum</th>
                    <th className="num">ST bullish share</th>
                    <th className="num">Wiki vs 28d</th>
                  </tr>
                </thead>
                <tbody>
                  {crowded.map((c) => (
                    <tr key={c.ticker} className="bg-neg-soft/40">
                      <td>
                        <Link href={`/companies/${c.ticker}`} className="flex items-baseline gap-2">
                          <span className="mono font-medium">{c.ticker}</span>
                          <span className="max-w-56 truncate text-muted">{c.name}</span>
                        </Link>
                      </td>
                      <td className="num"><ScoreBadge value={c.attention} /></td>
                      <td className="num"><ScoreBadge value={c.price_momentum} /></td>
                      <td className="num text-muted">{pct(c.st_bullish_share, 0)}</td>
                      <td className={`num ${signClass(c.wiki_vs_28d_pct)}`}>{ptsSigned(c.wiki_vs_28d_pct, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-3 text-[12.5px] text-muted">Nothing is crowded today.</div>
          )}
        </Section>

        {/* THEMES */}
        <Section title={`Themes · ${themes.length}`} subtitle="Sorted by attention · wiki = summed pageviews of the mapped articles" className="lg:col-span-2" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Theme</th>
                  <th className="num">Attention</th>
                  <th className="num">Breadth</th>
                  <th className="num">Wiki 7d avg</th>
                  <th className="num">vs 28d</th>
                  <th className="num">vs 1y</th>
                  <th>Apps in top-100</th>
                  <th className="num">GitHub repos</th>
                  <th className="num">Trend</th>
                  <th className="num">Pricing</th>
                  <th className="num">Narrative</th>
                  <th>Rising queries</th>
                </tr>
              </thead>
              <tbody>
                {themes.map((t) => (
                  <tr key={t.theme_id} className="align-top">
                    <td>
                      <Link href={`/themes/${t.theme_id}`} className="font-medium">
                        {t.name}
                      </Link>
                      {t.not_priced && (
                        <div className="mt-0.5">
                          <AttentionFlags notPriced />
                        </div>
                      )}
                    </td>
                    <td className="num"><ScoreBadge value={t.attention} /></td>
                    <td className="num text-muted">{t.breadth}</td>
                    <td className="num">{num(t.wiki_7d, 0)}</td>
                    <td className={`num ${signClass(t.wiki_vs_28d_pct)}`}>{ptsSigned(t.wiki_vs_28d_pct, 0)}</td>
                    <td className={`num ${signClass(t.wiki_vs_1y_pct)}`}>{ptsSigned(t.wiki_vs_1y_pct, 0)}</td>
                    <td className="max-w-56 whitespace-normal text-[12.5px] text-muted">{appRanks(t)}</td>
                    <td className="num text-muted">{num(t.gh_repos, 0)}</td>
                    <td className="num text-muted">{num(t.trend, 0)}</td>
                    <td className="num text-muted">{num(t.pricing, 0)}</td>
                    <td className="num text-muted">{num(t.narrative, 0)}</td>
                    <td className="max-w-md whitespace-normal">
                      <Chips items={t.rising_queries} />
                    </td>
                  </tr>
                ))}
                {!themes.length && (
                  <tr>
                    <td colSpan={12} className="text-muted">No themes in this snapshot.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* COMPANIES */}
        <Section title={`Companies · ${a.companies?.length ?? 0}`} subtitle="Click a column header to sort · wiki vs 28d / 1y in percent · bullish share from Stocktwits" className="lg:col-span-2" flush>
          <AttentionCompaniesTable rows={a.companies ?? []} />
        </Section>

        {/* MOVERS */}
        <Section title="Movers · companies" subtitle="By Wikipedia 7-day average vs the prior 28 days" flush>
          <div className="grid gap-x-6 divide-line sm:grid-cols-2 sm:divide-x">
            <div className="px-4 py-3">
              <div className="eyebrow mb-1.5">Up</div>
              <MoverList rows={companiesUp} empty="No company has enough history yet." />
            </div>
            <div className="px-4 py-3">
              <div className="eyebrow mb-1.5">Down</div>
              <MoverList rows={companiesDown} empty="No company has enough history yet." />
            </div>
          </div>
        </Section>

        <Section title="Movers · themes up" subtitle="By Wikipedia 7-day average vs the prior 28 days">
          <MoverList rows={themesUp} empty="No theme has enough history yet." />
        </Section>
      </div>

      <footer className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[11.5px] text-subtle">
        {Object.entries(a.weights ?? {}).map(([k, w]) => (
          <span key={k}>
            {ATTENTION_SOURCE_LABELS[k] ?? k} weight {num(w, 2)}
          </span>
        ))}
      </footer>
    </>
  );
}
