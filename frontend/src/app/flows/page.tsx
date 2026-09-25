import type { Metadata } from "next";
import { api } from "@/lib/api";
import { FLOW_GROUPS } from "@/lib/types";
import { GROUP_LABELS, ptsSigned, signed, signClass, yesNo, date } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { FlowTable } from "@/components/FlowTable";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Flows" };

export default async function FlowsPage() {
  const res = await api.flows();
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Capital flows" />
        <EmptyState message={res.message} />
      </>
    );
  }
  const f = res.data;
  const b = f.benchmark;

  return (
    <>
      <PageHeader
        title="Capital flows"
        subtitle="Where the money is going, measured from ETF price and volume behaviour relative to SPY."
        meta={<>as of {date(f.as_of)}</>}
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Section title="Benchmark" className="lg:col-span-1">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
            <span className="font-medium">{b?.symbol ?? "SPY"}</span>
            <span>
              1m <span className={signClass(b?.return_1m)}>{ptsSigned(b?.return_1m)}</span>
            </span>
            <span>
              3m <span className={signClass(b?.return_3m)}>{ptsSigned(b?.return_3m)}</span>
            </span>
            <span>
              12m <span className={signClass(b?.return_12m)}>{ptsSigned(b?.return_12m)}</span>
            </span>
            <span>
              &gt;200dma <span className="text-muted">{yesNo(b?.above_200dma)}</span>
            </span>
            <span>
              risk appetite <span className={signClass(f.risk_appetite)}>{signed(f.risk_appetite, 0)}</span>
            </span>
          </div>
        </Section>
        <Section title="Summary" className="lg:col-span-2">
          {f.summary?.length ? (
            <ul className="text-[13px]">
              {f.summary.map((s, i) => (
                <li key={i} className="py-0.5">· {s}</li>
              ))}
            </ul>
          ) : (
            <div className="text-[12.5px] text-muted">No summary sentences for this run.</div>
          )}
          <p className="mt-2 text-[12px] text-subtle">{f.method}</p>
        </Section>
      </div>

      <div className="flex flex-col gap-4">
        {FLOW_GROUPS.map((g) => {
          const rows = f.groups?.[g] ?? [];
          return (
            <Section key={g} title={GROUP_LABELS[g] ?? g} subtitle={`${rows.length} instruments · sorted by rotation score`} flush>
              <FlowTable rows={rows} showSector={g === "industry"} />
            </Section>
          );
        })}
      </div>
    </>
  );
}
