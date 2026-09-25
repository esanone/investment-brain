import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { num, signed, signClass } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Section } from "@/components/Section";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Themes" };

export default async function ThemesPage() {
  const res = await api.themes();
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Themes" />
        <EmptyState message={res.message} />
      </>
    );
  }
  const themes = [...res.data].sort((a, b) => (b.gap ?? -999) - (a.gap ?? -999));

  return (
    <>
      <PageHeader
        title="Themes"
        subtitle="Structural trend strength (exposure-weighted company reality + related ETF flow) vs what the market appears to price. ★ marks trend ≫ pricing · ● marks attention not yet priced."
      />
      <Section title={`${themes.length} themes`} subtitle="Sorted by expectations gap" flush>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Theme</th>
                <th className="num">Trend</th>
                <th className="num">Pricing</th>
                <th className="num">Gap</th>
                <th className="num">Attention</th>
                <th className="num">Company trend</th>
                <th className="num">ETF flow</th>
                <th className="num">Growth</th>
                <th className="num">Horizon</th>
                <th className="num">Cos.</th>
                <th>Top members</th>
              </tr>
            </thead>
            <tbody>
              {themes.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/themes/${t.id}`} className="font-medium">
                      {t.star && <span className="mr-1.5 text-warn">★</span>}
                      {t.name}
                    </Link>
                    {t.description && <div className="max-w-md truncate text-[12px] text-muted">{t.description}</div>}
                  </td>
                  <td className="num">{num(t.trend, 0)}</td>
                  <td className="num">{num(t.pricing, 0)}</td>
                  <td className={`num font-medium ${signClass(t.gap)}`}>{signed(t.gap, 0)}</td>
                  <td className="num">
                    {t.attention_not_priced && (
                      <span className="mr-1 text-accent" title="Attention rising while pricing is still low">
                        ●
                      </span>
                    )}
                    <ScoreBadge value={t.attention} />
                  </td>
                  <td className="num text-muted">{num(t.company_trend, 0)}</td>
                  <td className="num text-muted">{num(t.etf_flow, 0)}</td>
                  <td className="num text-muted">{num(t.growth, 0)}</td>
                  <td className="num text-muted">{t.horizon_years ?? "—"}y</td>
                  <td className="num text-muted">{t.n_companies}</td>
                  <td className="text-muted">
                    {(t.top_members ?? []).map((m, i) => (
                      <span key={m.ticker}>
                        {i > 0 && ", "}
                        <Link href={`/companies/${m.ticker}`}>{m.ticker}</Link>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
              {!themes.length && (
                <tr>
                  <td colSpan={11} className="text-muted">No themes scored in this run.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
