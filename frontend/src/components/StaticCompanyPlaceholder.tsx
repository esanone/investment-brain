"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Static export only: the single prerendered `/companies/_/` page. Company pages
 * are not exported per ticker; they live at `/company/?t=<TICKER>` (see
 * `companyHref`), so this just forwards there and leaves a link for no-JS readers.
 */
export function StaticCompanyPlaceholder() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/company/");
  }, [router]);
  return (
    <div className="mx-auto mt-10 max-w-2xl rounded-md border border-line bg-surface px-6 py-6">
      <h2 className="text-[15px] font-semibold">Company pages have moved</h2>
      <p className="mt-1 text-[13px] text-muted">
        In the static snapshot every company is rendered by one page:{" "}
        <Link href="/company/" className="text-accent hover:underline">
          open the company page
        </Link>{" "}
        or{" "}
        <Link href="/companies" className="text-accent hover:underline">
          browse the universe
        </Link>
        .
      </p>
    </div>
  );
}
