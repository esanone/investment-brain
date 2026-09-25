import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ThesisV2CalibrationBin } from "@/lib/types";
import { date, num } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ProbabilityRange } from "@/components/ProbabilityRange";
import { Section } from "@/components/Section";
import { AdoptionStageChip, ConfidenceChip, ThesisStatusChip } from "@/components/ThesisV2Chips";
import { ThesisV2NewForm } from "@/components/ThesisV2NewForm";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Thesis v2" };

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

/** Sort calibration bins by their lower bound ("0-10" … "90-100"). */
function binRows(calibration: Record<string, ThesisV2CalibrationBin> | undefined): [string, ThesisV2CalibrationBin][] {
  return Object.entries(calibration ?? {}).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
}

export default async function ThesisV2LedgerPage() {
  const [res, health] = await Promise.all([api.thesisV2List(), api.health()]);
  const running = health.ok ? Boolean(health.data.running_thesis_v2) : false;

  if (!res.ok && res.status !== 404) {
    return (
      <>
        <PageHeader title="Thesis v2" subtitle={<span className="text-accent">{INTRO}</span>} />
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
        title="Thesis v2"
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
