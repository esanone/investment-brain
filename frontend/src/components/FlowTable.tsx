import type { Instrument } from "@/lib/types";
import { ptsSigned, signed, signClass, yesNo } from "@/lib/format";
import { DivergingBar } from "./DivergingBar";

const TREND_GLYPH: Record<string, string> = { accelerating: "▲", steady: "→", decelerating: "▼" };

/** Full instrument table for one flow group. */
export function FlowTable({ rows, showSector = false }: { rows: Instrument[]; showSector?: boolean }) {
  if (!rows.length) return <div className="px-4 py-3 text-[12.5px] text-muted">No instruments scored in this group.</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Instrument</th>
            {showSector && <th>Sector</th>}
            <th>Score</th>
            <th className="num"></th>
            <th>Trend</th>
            <th className="num">RS 1m</th>
            <th className="num">RS 3m</th>
            <th className="num">RS 6m</th>
            <th className="num">RS accel</th>
            <th className="num">Rel vol</th>
            <th className="num">Money flow</th>
            <th className="num">Ret 3m</th>
            <th className="num">Ret 12m</th>
            <th className="num">&gt;200dma</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td>
                <span className="font-medium">{r.symbol}</span>
                <span className="ml-2 text-muted">{r.name}</span>
              </td>
              {showSector && <td className="text-muted">{r.sector ?? "—"}</td>}
              <td>
                <DivergingBar value={r.score} width={110} />
              </td>
              <td className={`num font-medium ${signClass(r.score)}`}>{signed(r.score, 0)}</td>
              <td className="text-muted">
                <span className="mr-1 text-subtle">{TREND_GLYPH[r.trend] ?? ""}</span>
                {r.trend}
              </td>
              <td className={`num ${signClass(r.rs_1m)}`}>{signed(r.rs_1m, 1)}</td>
              <td className={`num ${signClass(r.rs_3m)}`}>{signed(r.rs_3m, 1)}</td>
              <td className={`num ${signClass(r.rs_6m)}`}>{signed(r.rs_6m, 1)}</td>
              <td className={`num ${signClass(r.rs_accel)}`}>{signed(r.rs_accel, 1)}</td>
              <td className={`num ${signClass(r.rel_volume)}`}>{ptsSigned(r.rel_volume, 0)}</td>
              <td className={`num ${signClass(r.money_flow)}`}>{signed(r.money_flow, 2)}</td>
              <td className={`num ${signClass(r.return_3m)}`}>{ptsSigned(r.return_3m)}</td>
              <td className={`num ${signClass(r.return_12m)}`}>{ptsSigned(r.return_12m)}</td>
              <td className="num text-muted">{yesNo(r.above_200dma)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
