import { api } from "@/lib/api";
import { IS_STATIC } from "@/lib/static";
import { date } from "@/lib/format";
import { AnalyzeTicker } from "@/components/AnalyzeTicker";
import { CompanyView } from "@/components/CompanyView";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StaticCompanyPlaceholder } from "@/components/StaticCompanyPlaceholder";

export * from "@/lib/segment-config-dynamic-route";

/** The one param the static export prerenders for this route (see generateStaticParams). */
const STATIC_PLACEHOLDER = "_";

/**
 * Live mode renders any ticker on demand. The static export does NOT prerender a
 * page per ticker (the universe is ~550 names): company pages are served by the
 * single client-rendered `/company/?t=<TICKER>` route instead, and every link goes
 * there through `companyHref()`. `output: "export"` still needs at least one
 * concrete param for a dynamic segment, hence the lone placeholder, which only
 * forwards to `/company/`.
 */
export async function generateStaticParams(): Promise<{ ticker: string }[]> {
  return IS_STATIC ? [{ ticker: STATIC_PLACEHOLDER }] : [];
}

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return { title: IS_STATIC ? "Companies" : ticker.toUpperCase() };
}

export default async function CompanyPage({ params }: { params: Promise<{ ticker: string }> }) {
  if (IS_STATIC) return <StaticCompanyPlaceholder />;
  const { ticker } = await params;
  const res = await api.company(ticker);
  if (!res.ok) {
    return (
      <>
        <PageHeader title={ticker.toUpperCase()} />
        {res.status === 404 ? (
          // Ticker is simply not in the run: offer on-demand analysis. Anything else (API down, 5xx) keeps the run commands.
          <AnalyzeTicker ticker={ticker.toUpperCase()} message={res.message} />
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }
  // On-demand rows are scored against the latest run's universe; show which one.
  const runAsOf = res.data.on_demand ? await api.runs().then((r) => (r.ok && r.data[0] ? date(r.data[0].as_of) : null)) : null;
  return <CompanyView data={res.data} runAsOf={runAsOf} />;
}
