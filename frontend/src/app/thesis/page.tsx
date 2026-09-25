import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { date, num, pct } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { Meter } from "@/components/Meter";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { StructuralShiftsTable } from "@/components/StructuralShiftsTable";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Long-term thesis" };

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

function ConvictionBar({ value }: { value: number | null | undefined }) {
  const v = toScore(value) ?? 0;
  return (
    <div className="h-1.5 w-32 rounded-sm bg-[var(--meter-track)]">
      <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
    </div>
  );
}

/** Split the thesis into paragraphs on blank lines (or single newlines when there are none). */
function paragraphs(text: string): string[] {
  const parts = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  return text.split(/\n/).map((s) => s.trim()).filter(Boolean);
}

export default async function ThesisPage() {
  const [res, histRes] = await Promise.all([api.thesis(), api.thesisHistory()]);
  const history = histRes.ok ? histRes.data : [];

  if (!res.ok) {
    return (
      <>
        <PageHeader title="Long-term thesis" />
        {res.status === 404 ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
            <h2 className="text-[15px] font-semibold">No long-term thesis yet</h2>
            <p className="mt-1 text-[13px] text-muted">
              The Human Future Engine reconciles every morning brief&apos;s long-term observations into one cumulative thesis. It is rebuilt
              automatically at the end of each morning run once at least one brief exists; there is no separate button.
            </p>
            <pre className="mono mt-2 overflow-x-auto rounded border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-6">
              {"cd backend && .venv/bin/python -m brain.pipeline longterm"}
            </pre>
            <p className="mono mt-2 text-[12px] text-subtle">{res.message}</p>
          </div>
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }

  const t = res.data;
  const ranking = [...(t.theme_ranking ?? [])].sort((a, b) => (b.conviction ?? 0) - (a.conviction ?? 0));
  const themeNames: Record<string, string> = Object.fromEntries(ranking.map((r) => [r.theme_id, r.theme]));
  const dates = [...(t.observation_dates ?? [])].sort();
  const paras = paragraphs(t.thesis ?? "");
  const headlinesOnly = !t.llm_provider;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span>Long-term thesis</span>
            {headlinesOnly ? <span className="chip">headlines-only mode</span> : <span className="chip border-accent bg-accent-soft text-accent">LLM · {t.llm_provider}</span>}
          </span>
        }
        subtitle={
          <>
            {t.n_briefs ?? 0} brief{t.n_briefs === 1 ? "" : "s"} reconciled
            {dates.length > 0 && (
              <>
                {" "}
                · {date(dates[0])}
                {dates.length > 1 && <> → {date(dates[dates.length - 1])}</>}
              </>
            )}{" "}
            · {t.structural_shifts?.length ?? 0} structural shifts · {ranking.length} themes ranked · llm {t.llm_provider ?? "off"}
          </>
        }
        meta={
          <>
            as of {date(t.as_of)} · generated {fmtTime(t.generated_at)} · rebuilt automatically with each morning run
          </>
        }
        actions={
          <div className="w-40">
            <Meter label={<span className="text-muted">Confidence</span>} value={toScore(t.confidence)} size="sm" />
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded border border-line bg-surface-2 px-4 py-2 text-[12.5px] text-muted">
        <span>
          Cumulative view across the morning briefs. It is rebuilt with each morning run, so there is no button here: generate a{" "}
          <Link href="/brief" className="text-accent hover:underline">brief</Link> and the thesis follows.
        </span>
        {dates.length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            <span className="eyebrow mr-1">Briefs</span>
            {dates.map((d) => (
              <span key={d} className="chip mono">{date(d)}</span>
            ))}
          </span>
        )}
      </div>

      {headlinesOnly && (
        <div className="mb-4 rounded border border-line bg-surface-2 px-4 py-2 text-[12.5px] text-muted">
          No LLM key configured — theme conviction is the frequency of long-term observations per theme; add <span className="mono">ANTHROPIC_API_KEY</span> to{" "}
          <span className="mono">backend/.env</span> for the full thesis.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Thesis"
          subtitle={<span className="text-accent">Human Future Engine · which shifts cut the cost, time or friction of a fundamental human need</span>}
          className="lg:col-span-2"
        >
          {paras.length ? (
            <div className="flex max-w-4xl flex-col gap-3">
              {paras.map((p, i) => (
                <p key={i} className="text-[13.5px] leading-relaxed">{p}</p>
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-muted">No thesis text.</div>
          )}
        </Section>

        <Section
          title="Structural shifts"
          subtitle={`${t.structural_shifts?.length ?? 0} shifts · each labelled by how it is known · expand a row for its evidence`}
          className="lg:col-span-2"
          flush
        >
          <StructuralShiftsTable rows={t.structural_shifts ?? []} themeNames={themeNames} />
        </Section>

        <Section title="Theme ranking" subtitle="Long-term conviction per theme · feeds the LT column and position sizing in the portfolio" className="lg:col-span-2" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Theme</th>
                  <th>Conviction</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr key={`${r.theme_id}-${i}`} className="align-top">
                    <td className="num text-subtle">{i + 1}</td>
                    <td>
                      <Link href={`/themes/${r.theme_id}`} className="font-medium">
                        {r.theme}
                      </Link>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <ConvictionBar value={r.conviction} />
                        <span className="w-9 text-right text-[12px] font-medium">{pct(r.conviction, 0)}</span>
                      </div>
                    </td>
                    <td className="text-[12.5px] text-muted">
                      <div className="max-w-xl whitespace-normal">{r.why}</div>
                    </td>
                  </tr>
                ))}
                {!ranking.length && (
                  <tr>
                    <td colSpan={4} className="text-muted">No themes ranked.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Beneficiary profiles" subtitle="What kind of company benefits · constraint owner, toll road, picks-and-shovels">
          <Bullets items={t.beneficiary_profiles} empty="None identified." />
        </Section>

        <Section title="Not-priced candidates" subtitle="Universe names whose long-term exposure the scores suggest is not yet priced" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {(t.not_priced_candidates ?? []).map((c, i) => (
                  <tr key={`${c.ticker}-${i}`} className="align-top">
                    <td>
                      <Link href={`/companies/${c.ticker}`} className="mono font-medium">
                        {c.ticker}
                      </Link>
                    </td>
                    <td className="text-[12.5px] text-muted">
                      <div className="max-w-md whitespace-normal">{c.why}</div>
                    </td>
                  </tr>
                ))}
                {!t.not_priced_candidates?.length && (
                  <tr>
                    <td colSpan={2} className="text-muted">No candidates named.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Anti-theses" subtitle="Popular long-term ideas the evidence does not support">
          <Bullets items={t.anti_theses} empty="None recorded." />
        </Section>

        <Section title="What would change our mind">
          <Bullets items={t.what_would_change} empty="Nothing recorded." />
        </Section>

        <Section title="History" subtitle={histRes.ok ? `${history.length} builds · newest first` : histRes.message} className="lg:col-span-2" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>As of</th>
                  <th className="num">Briefs</th>
                  <th className="num">Confidence</th>
                  <th>Top themes</th>
                  <th>LLM</th>
                  <th>Build</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={`${h.id}-${i}`} className={i === 0 ? "font-medium" : ""}>
                    <td className="mono">{date(h.as_of)}</td>
                    <td className="num">{h.n_briefs ?? "—"}</td>
                    <td className="num">{pct(h.confidence === null || h.confidence === undefined ? null : h.confidence <= 1 ? h.confidence : h.confidence / 100, 0)}</td>
                    <td className="max-w-xl truncate text-[12.5px] text-muted" title={(h.top_themes ?? []).map(([n, c]) => `${n} ${num(c * 100, 0)}%`).join(", ")}>
                      {(h.top_themes ?? []).length
                        ? h.top_themes.map(([n, c], j) => (
                            <span key={`${n}-${j}`}>
                              {j > 0 && <span className="text-subtle"> · </span>}
                              {n} <span className="font-medium text-ink">{pct(c, 0)}</span>
                            </span>
                          ))
                        : "—"}
                    </td>
                    <td className="text-muted">{h.llm ?? "—"}</td>
                    <td className="mono text-subtle">{h.id}</td>
                  </tr>
                ))}
                {!history.length && (
                  <tr>
                    <td colSpan={6} className="text-muted">No thesis history yet.</td>
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
