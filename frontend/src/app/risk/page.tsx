import type { Metadata } from "next";
import { api } from "@/lib/api";
import { num, signed, signClass, date } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { Meter } from "@/components/Meter";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Risk" };

export default async function RiskPage() {
  const res = await api.risk();
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Risk & posture" />
        <EmptyState message={res.message} />
      </>
    );
  }
  const r = res.data;
  const p = r.posture;
  const assets = Object.keys(p?.baseline ?? {});

  return (
    <>
      <PageHeader title="Risk & posture" subtitle="Portfolio posture recommendation, kept separate from stock selection." meta={<>as of {date(r.as_of)}</>} />

      <div className="grid gap-4 lg:grid-cols-5">
        <Section title="Risk score" className="lg:col-span-2">
          <div className="flex items-baseline gap-3">
            <span className="text-[40px] font-semibold leading-none">{num(r.risk_score, 0)}</span>
            <span className="text-[15px] font-medium">{r.label}</span>
          </div>
          <div className="mt-3">
            <Meter label={<span className="text-muted">0 benign · 100 stress</span>} value={r.risk_score} />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-subtle">
            <span>Benign &lt;38</span>
            <span>Stable &lt;55</span>
            <span>Deteriorating &lt;72</span>
            <span>Stress</span>
          </div>
          {r.hedges?.length > 0 && (
            <div className="mt-4">
              <div className="eyebrow mb-1.5">Hedges</div>
              <ul className="text-[13px]">
                {r.hedges.map((h, i) => (
                  <li key={i} className="py-0.5">· {h}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Posture" subtitle="Baseline → recommended allocation" className="lg:col-span-3" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="num">Baseline</th>
                  <th className="num"></th>
                  <th className="num">Recommended</th>
                  <th className="num">Δ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((k) => {
                  const b = p.baseline[k];
                  const rec = p.recommended?.[k] ?? null;
                  const diff = rec === null ? null : rec - b;
                  return (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num text-muted">{num(b, 0)}%</td>
                      <td className="num text-subtle">→</td>
                      <td className="num font-medium">{num(rec, 0)}%</td>
                      <td className={`num ${signClass(diff)}`}>{signed(diff, 0)}</td>
                      <td className="w-40">
                        <div className="h-1.5 w-full rounded-sm bg-[var(--meter-track)]">
                          <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.min(100, rec ?? 0)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>Beta target</td>
                  <td className="num text-muted">{num(p?.beta_target?.baseline, 2)}</td>
                  <td className="num text-subtle">→</td>
                  <td className="num font-medium">{num(p?.beta_target?.recommended, 2)}</td>
                  <td className={`num ${signClass((p?.beta_target?.recommended ?? 0) - (p?.beta_target?.baseline ?? 0))}`}>
                    {p?.beta_target?.recommended === null || p?.beta_target?.baseline === null
                      ? "—"
                      : signed((p?.beta_target?.recommended ?? 0) - (p?.beta_target?.baseline ?? 0), 2)}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Signals" subtitle={`${r.signals?.length ?? 0} signals · weighted average = risk score`} className="lg:col-span-5" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th className="num">Value</th>
                  <th className="num">z</th>
                  <th className="num">Risk score</th>
                  <th className="num">Weight</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {(r.signals ?? []).map((s) => (
                  <tr key={s.name}>
                    <td className="font-medium">{s.name}</td>
                    <td className="num">{num(s.value, 2)}</td>
                    <td className={`num ${signClass(s.z)}`}>{signed(s.z, 2)}</td>
                    <td className="num">{num(s.risk_score, 0)}</td>
                    <td className="num text-muted">{num(s.weight, 1)}</td>
                    <td className="text-muted">{s.note}</td>
                  </tr>
                ))}
                {!r.signals?.length && (
                  <tr>
                    <td colSpan={6} className="text-muted">No signals available; score defaults to 50.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

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
