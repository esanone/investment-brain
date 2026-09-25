import type { NextConfig } from "next";

/**
 * `NEXT_PUBLIC_STATIC=1` (npm run build:static) turns the site into a fully
 * static export in `out/` that reads the JSON snapshot under public/data and
 * needs no backend (Vercel, phone). Unset, nothing changes: the dev server and
 * `next build` keep talking to the API on :8000.
 */
const isStatic = process.env.NEXT_PUBLIC_STATIC === "1";

const nextConfig: NextConfig = isStatic
  ? {
      output: "export",
      images: { unoptimized: true },
      trailingSlash: true,
    }
  : {};

export default nextConfig;
