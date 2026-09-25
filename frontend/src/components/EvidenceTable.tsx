import type { ThesisV2Evidence } from "@/lib/types";
import { date, num, signed, signClass } from "@/lib/format";
import { EvidenceDirectionChip, KindChip } from "./ThesisV2Chips";

/**
 * Evidence ledger of a Thesis v2 record in the engine's order (indexes matter:
 * monthly updates retire items by index). Retired rows are struck through and
 * muted; they no longer enter the posterior.
 */
export function EvidenceTable({ rows }: { rows: ThesisV2Evidence[] }) {
  if (!rows.length) return <div className="px-4 py-3 text-[12.5px] text-muted">No evidence recorded.</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Claim</th>
            <th>Direction</th>
            <th>Strength</th>
            <th className="num" title="0-1 data quality (survey size, source rigor, recency)">Quality</th>
            <th className="num" title="0-1: 1 = independent of the other evidence">Indep.</th>
            <th className="num" title="quality × independence">Weight</th>
            <th className="num" title="Likelihood ratio: strong 3.0 · moderate 2.0 · weak 1.3 (inverted when contradicting)">LR</th>
            <th className="num" title="weight × ln(LR) — the item's contribution to the posterior log-odds">Wtd log-LR</th>
            <th>Kind</th>
            <th>Source</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => {
            const retired = e.retired === true;
            return (
              <tr key={i} className={`align-top ${retired ? "dim line-through" : ""}`} title={retired ? "Retired by a monthly update · excluded from the posterior" : undefined}>
                <td className="num text-subtle">{i}</td>
                <td>
                  <div className="w-96 whitespace-normal">{e.claim}</div>
                </td>
                <td>
                  <EvidenceDirectionChip direction={e.direction} />
                </td>
                <td className="text-muted">{e.strength ?? "—"}</td>
                <td className="num">{num(e.quality, 2)}</td>
                <td className="num">{num(e.independence, 2)}</td>
                <td className="num">{num(e.weight, 2)}</td>
                <td className="num text-muted">{num(e.lr, 2)}</td>
                <td className={`num font-medium ${retired ? "" : signClass(e.log_lr_weighted)}`}>{signed(e.log_lr_weighted, 3)}</td>
                <td>
                  <KindChip kind={e.kind} />
                </td>
                <td className="max-w-48 truncate text-[12.5px] text-muted" title={e.source}>
                  {e.source || "—"}
                </td>
                <td className="mono text-muted">
                  {date(e.date)}
                  {e.added && <div className="text-[11px] text-subtle">added {date(e.added)}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
