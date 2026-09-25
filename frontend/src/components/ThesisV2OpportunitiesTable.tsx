"use client";

import Link from "next/link";
import { useState } from "react";
import type { ThesisV2Candidate } from "@/lib/types";
import { num, signClass, signed } from "@/lib/format";
import { ScoreBadge } from "@/components/ScoreBadge";
import { ReadinessChip, RoleChip, ThesisRefChip } from "@/components/ThesisV2Chips";

const ROLES_SHOWN = 2;

/**
 * Candidate table of the "Stocks positioned for the theses" section: one row per
 * universe ticker that an open thesis's value pool names, ranked by the engine's
 * final score. A client component only for the "ready only" filter; the rows
 * arrive sorted by score from the API and are re-sorted defensively here.
 */
export function ThesisV2OpportunitiesTable({ rows, meta }: { rows: ThesisV2Candidate[]; meta?: React.ReactNode }) {
  const [readyOnly, setReadyOnly] = useState(false);
  const sorted = [...rows].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const nReady = sorted.filter((r) => r.buy_readiness === "ready").length;
  const shown = readyOnly ? sorted.filter((r) => r.buy_readiness === "ready") : sorted;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-line px-4 py-2 text-[12px] text-muted">
        <span className="min-w-0">
          {shown.length} of {rows.length} candidate{rows.length === 1 ? "" : "s"} · <span className="text-pos">{nReady} ready</span>
          {meta && <> · {meta}</>}
        </span>
        <label className="inline-flex shrink-0 cursor-pointer select-none items-center gap-1.5">
          <input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} className="accent-[var(--accent)]" />
          Ready only
        </label>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Name</th>
              <th>Sector</th>
              <th className="num" title="Exposure × (0.5 + opportunity/100) × (1 + gap/100) × technical readiness × attention factor">
                Score
              </th>
              <th className="num" title="Sum over open theses of posterior × value-pool weight · headwind = the negative part">
                Exposure
              </th>
              <th title="Theses whose value pools name this ticker · tooltip = contribution">Theses</th>
              <th title={`Value-pool roles (first ${ROLES_SHOWN} of up to 6) · layer · what it becomes`}>Roles</th>
              <th className="num" title="Strategist opportunity score, 0-100">Opp.</th>
              <th className="num" title="Expectations gap = reality − pricing">Gap</th>
              <th title="Trend-template score and stage · ✓ = passes the template">Technical</th>
              <th title="Attention score · not priced / crowded flags">Attention</th>
              <th title="ready = technicals pass, opportunity ≥ 55, gap ≥ 0 · watch = technicals ≥ 50 or opportunity ≥ 55 · not yet = neither">
                Readiness
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const headwind = r.headwind !== null && r.headwind !== undefined && r.headwind < 0 ? r.headwind : null;
              const extraRoles = Math.max(0, (r.roles?.length ?? 0) - ROLES_SHOWN);
              return (
                <tr key={r.ticker} className="align-top">
                  <td>
                    <Link href={`/companies/${r.ticker}`} className="mono font-medium">
                      {r.ticker}
                    </Link>
                  </td>
                  <td>
                    <div className="max-w-44 truncate" title={r.name ?? undefined}>
                      {r.name || "—"}
                    </div>
                  </td>
                  <td className="text-muted">
                    <div className="max-w-36 truncate" title={r.sector ?? undefined}>
                      {r.sector || "—"}
                    </div>
                  </td>
                  <td className="num">
                    <span className="text-[15px] font-semibold">{num(r.score, 2)}</span>
                  </td>
                  <td className="num">
                    <div>{num(r.thesis_exposure, 2)}</div>
                    {headwind !== null && (
                      <div className="text-[11px] text-neg" title="Sum of the negative contributions">
                        {num(headwind, 2)}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="flex max-w-48 flex-wrap gap-1 whitespace-normal">
                      {r.theses?.length ? r.theses.map((x) => <ThesisRefChip key={x.thesis_id} id={x.thesis_id} contribution={x.contribution} />) : <span className="text-muted">—</span>}
                    </div>
                  </td>
                  <td>
                    <div className="flex max-w-72 flex-wrap items-center gap-1 whitespace-normal">
                      {r.roles?.length ? (
                        r.roles.slice(0, ROLES_SHOWN).map((x, i) => <RoleChip key={`${x.thesis_id}-${i}`} layer={x.layer} becomes={x.becomes} thesisId={x.thesis_id} posterior={x.posterior} />)
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {extraRoles > 0 && (
                        <span className="text-[11.5px] text-subtle" title={r.roles.slice(ROLES_SHOWN).map((x) => `${x.thesis_id} · ${x.layer}`).join("\n")}>
                          +{extraRoles}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="num">{num(r.opportunity, 0)}</td>
                  <td className={`num font-medium ${signClass(r.expectations_gap)}`}>{signed(r.expectations_gap, 0)}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <ScoreBadge value={r.technical_score} />
                      <span className="text-[12px] text-muted">{r.technical_stage || "—"}</span>
                      {r.technical_ready && (
                        <span className="text-[11.5px] text-pos" title="Passes the trend template">
                          ✓
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <ScoreBadge value={r.attention} />
                      {r.attention_not_priced && <span className="chip border-pos bg-pos-soft text-pos">not priced</span>}
                      {r.crowded && <span className="chip border-warn bg-warn-soft text-warn">crowded</span>}
                    </div>
                  </td>
                  <td>
                    <ReadinessChip value={r.buy_readiness} />
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={12} className="text-muted">
                  {readyOnly ? "No candidate passes the entry gate today — untick “Ready only” to see the watch list." : "No candidates — no open thesis names a universe ticker in its value pools."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
