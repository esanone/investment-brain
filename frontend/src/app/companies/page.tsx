import type { Metadata } from "next";
import { api } from "@/lib/api";
import { CompaniesTable } from "@/components/CompaniesTable";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const res = await api.companies({ sort: "total", limit: 500 });
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Companies" />
        <EmptyState message={res.message} />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Companies" subtitle="Click a column header to sort. Scores are cross-sectional percentiles (0-100); value is sector-relative." />
      <Section title={`Universe · ${res.data.length} companies`} flush>
        <CompaniesTable rows={res.data} />
      </Section>
    </>
  );
}
