import type { Metadata } from "next";
import { Suspense } from "react";
import { CompanyClientPage } from "@/components/CompanyClientPage";
import { PageHeader } from "@/components/PageHeader";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Company" };

/**
 * `/company/?t=<TICKER>`: the static export's one company page. The ticker is in
 * the query string because `output: "export"` can only serve concrete routes, and
 * a page per ticker made the export too large. `useSearchParams` needs the
 * Suspense boundary to prerender. Live mode forwards to `/companies/<TICKER>`.
 */
export default function CompanyQueryPage() {
  return (
    <Suspense fallback={<PageHeader title="Company" subtitle="Loading the snapshot…" />}>
      <CompanyClientPage />
    </Suspense>
  );
}
