import type { Metadata } from "next";
import { api } from "@/lib/api";
import { DIM_KEYS, REGIME_NAMES } from "@/lib/types";
import { DIM_LABELS, num, signed, signClass, date } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { Meter } from "@/components/Meter";
import { PageHeader } from "@/components/PageHeader";
import { ProbabilityChart, REGIME_COLORS } from "@/components/ProbabilityChart";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Regime" };

export default async function RegimePage() {
  const res = await api.regime();
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Economic regime" />
        <EmptyState message={res.message} />
      </>
    );
  }
  const r = res.data;
  const window = r.trend?.window_days ?? 60;

  return (
    <>
      <PageHeader
        title="Economic regime"
        subtitle={r.headline}
        meta={<>as of {date(r.as_of)} · deltas over {window} days</>}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <Section title="Regime probabilities" className="lg:col-span-3">
          <div className="flex h-3 w-full overflow-hidden rounded-sm bg-[var(--meter-track)]">
            {REGIME_NAMES.map((k) => (
              <div key={k} style={{ width: `${Math.max(0, r.regime?.probabilities?.[k] ?? 0)}%`, background: REGIME_COLORS[k] }} />
            ))}
          </div>
          <table className="tbl mt-3">
            <thead>
              <tr>
                <th>Regime</th>
                <th className="num">Now</th>
                <th className="num">{window}d ago</th>
                <th className="num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {REGIME_NAMES.map((k) => {
                const active = r.regime?.label === k;
                return (
                  <tr key={k} className={active ? "font-medium" : ""}>
                    <td>
                      <span className="mr-2 inline-block size-2 rounded-sm" style={{ background: REGIME_COLORS[k] }} />
                      {k}
                      {active && <span className="ml-2 text-[11px] text-accent">most likely</span>}
                    </td>
                    <td className="num">{num(r.regime?.probabilities?.[k], 1)}%</td>
                    <td className="num text-muted">{num(r.trend?.probabilities_prior?.[k], 1)}%</td>
                    <td className={`num ${signClass(r.trend?.probability_delta?.[k])}`}>{signed(r.trend?.probability_delta?.[k], 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-4 rounded border border-line bg-surface-2 px-3 py-2.5 text-[13px]">
            <div className="font-medium">{r.regime?.label}</div>
            <div className="mt-0.5 text-muted">{r.regime?.description}</div>
            {r.regime?.beneficiaries?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.regime.beneficiaries.map((b) => (
                  <span key={b} className="chip">{b}</span>
                ))}
              </div>
            )}
          </div>
        </Section>

        <Section title="Dimensions" subtitle="0-100 · momentum is the weighted 3-month z-score" className="lg:col-span-2">
          <div className="flex flex-col gap-3">
            {DIM_KEYS.map((k) => {
              const dim = r.dimensions?.[k];
              return (
                <Meter
                  key={k}
                  label={DIM_LABELS[k]}
                  value={dim?.score ?? null}
                  delta={r.trend?.dimension_delta?.[k] ?? null}
                  deltaSuffix={` / ${window}d`}
                  hint={
                    <>
                      momentum z <span className={signClass(dim?.momentum)}>{signed(dim?.momentum, 2)}</span> · {dim?.indicators?.length ?? 0} indicators
                    </>
                  }
                />
              );
            })}
          </div>
        </Section>

        <Section title="Probability history" subtitle="Monthly, stacked to 100%" className="lg:col-span-5">
          <ProbabilityChart history={r.history ?? []} />
        </Section>

        {DIM_KEYS.map((k) => {
          const dim = r.dimensions?.[k];
          const inds = dim?.indicators ?? [];
          return (
            <Section
              key={k}
              title={`${DIM_LABELS[k]} · ${num(dim?.score, 0)}`}
              subtitle={`${inds.length} indicators · weighted score ${num(dim?.score, 1)}, momentum z ${signed(dim?.momentum, 2)}`}
              className="lg:col-span-5"
              flush
            >
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Indicator</th>
                      <th>Transform</th>
                      <th className="num">Value</th>
                      <th className="num">Raw</th>
                      <th className="num">z level</th>
                      <th className="num">z momentum</th>
                      <th className="num">Score</th>
                      <th className="num">Weight</th>
                      <th className="num">As of</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inds.map((i) => (
                      <tr key={i.id}>
                        <td>
                          {i.name}
                          <span className="ml-2 mono text-subtle">{i.id}</span>
                        </td>
                        <td className="text-muted">{i.transform}</td>
                        <td className="num">{num(i.value, 2)}</td>
                        <td className="num text-muted">{num(i.raw_value, 2)}</td>
                        <td className={`num ${signClass(i.z_level)}`}>{signed(i.z_level, 2)}</td>
                        <td className={`num ${signClass(i.z_momentum)}`}>{signed(i.z_momentum, 2)}</td>
                        <td className="num font-medium">{num(i.score, 1)}</td>
                        <td className="num text-muted">{num(i.weight, 2)}</td>
                        <td className="num text-muted">{date(i.as_of)}</td>
                      </tr>
                    ))}
                    {!inds.length && (
                      <tr>
                        <td colSpan={9} className="text-muted">No indicators available (defaults to 50).</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>
          );
        })}

        {r.notes?.length > 0 && (
          <Section title="Notes" className="lg:col-span-5">
            <ul className="list-disc pl-5 text-[12.5px] text-muted">
              {r.notes.map((n, i) => (
                <li key={i} className="py-0.5">{n}</li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </>
  );
}
