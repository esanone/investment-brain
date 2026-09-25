/**
 * Static-export mode (`NEXT_PUBLIC_STATIC=1`, `npm run build:static`).
 *
 * The whole site is prerendered to `out/` and served without the FastAPI
 * backend: server components read the JSON snapshot that the backend exported
 * to `public/data/api/**.json` (see `request()` in api.ts), and the client
 * components that would otherwise call the API fetch the same files from
 * `/data/api/...` in the browser. Everything here is browser-safe; the only
 * Node-side reader lives in api.ts behind a `typeof window` guard.
 *
 * `process.env.NEXT_PUBLIC_STATIC` is inlined at build time, so `IS_STATIC` is
 * a compile-time constant in both the server and the browser bundles.
 */
import type { PriceInterval, PriceRange, Prices, SearchResult } from "./types";

export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === "1";

/** Browser path prefix of the exported snapshot (files under `public/data`). */
export const STATIC_DATA_BASE = "/data";

/**
 * Map an API path to its exported file, relative to `public/data`:
 *   /api/overview                              -> api/overview.json
 *   /api/companies/NVDA                        -> api/companies/NVDA.json
 *   /api/prices/NVDA?range=1y&interval=1d      -> api/prices/NVDA__1y_1d.json
 * Query strings other than the price range/interval are ignored (the export
 * holds one file per endpoint, e.g. /api/companies?sort=total -> companies.json).
 */
export function staticFileFor(apiPath: string): string {
  const q = apiPath.indexOf("?");
  const pathname = q === -1 ? apiPath : apiPath.slice(0, q);
  const query = new URLSearchParams(q === -1 ? "" : apiPath.slice(q + 1));
  const rel = pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/");
  if (rel.startsWith("api/prices/")) {
    const range = query.get("range") ?? "1y";
    const interval = query.get("interval") ?? "1d";
    return `${rel}__${range}_${interval}.json`;
  }
  return `${rel}.json`;
}

/** Browser URL of the exported file for an API path. */
export function staticDataUrl(apiPath: string): string {
  return `${STATIC_DATA_BASE}/${staticFileFor(apiPath)}`;
}

export type StaticResult<T> = { ok: true; data: T } | { ok: false; status: number | null; message: string };

/** Fetch one exported JSON file from the browser. Never throws; 404 mirrors the live API's "not found". */
export async function fetchStaticJson<T>(apiPath: string, signal?: AbortSignal): Promise<StaticResult<T>> {
  const url = staticDataUrl(apiPath);
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return { ok: false, status: res.status, message: `${res.status} ${res.statusText} (${url})` };
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, status: null, message: `Could not load ${url} (${message})` };
  }
}

// ---------------------------------------------------------------- prices

/** Which exported file backs each chart timeframe, and how many months of it to show. */
const PRICE_SOURCE: Record<PriceRange, { file: { range: "1y" | "5y"; interval: PriceInterval }; months: number | null }> = {
  "1m": { file: { range: "1y", interval: "1d" }, months: 1 },
  "3m": { file: { range: "1y", interval: "1d" }, months: 3 },
  "6m": { file: { range: "1y", interval: "1d" }, months: 6 },
  "1y": { file: { range: "1y", interval: "1d" }, months: null },
  "2y": { file: { range: "5y", interval: "1w" }, months: 24 },
  "5y": { file: { range: "5y", interval: "1w" }, months: null },
};

function monthsBefore(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 - months, d));
  return dt.toISOString().slice(0, 10);
}

/** Cut a Prices payload down to the last `months` months (bars and the aligned indicator arrays). */
function slicePrices(p: Prices, range: PriceRange, months: number | null): Prices {
  if (months === null || !p.bars.length) return { ...p, range };
  const cutoff = monthsBefore(p.bars[p.bars.length - 1].t, months);
  let start = p.bars.findIndex((b) => b.t >= cutoff);
  if (start < 0) start = 0;
  const bars = p.bars.slice(start);
  const indicators = Object.fromEntries(
    Object.entries(p.indicators ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.slice(start) : v]),
  ) as Prices["indicators"];
  const first = bars[0]?.c;
  const last = bars[bars.length - 1]?.c;
  const change_range_pct = first && last ? Math.round(((last / first - 1) * 100) * 100) / 100 : null;
  return { ...p, range, n: bars.length, bars, indicators, latest: { ...p.latest, change_range_pct } };
}

/**
 * Static stand-in for `api.prices()`: the export holds `<SYM>__1y_1d.json` and
 * `<SYM>__5y_1w.json`; shorter ranges are sliced client-side.
 */
export async function staticPrices(symbol: string, range: PriceRange, signal?: AbortSignal): Promise<StaticResult<Prices>> {
  const src = PRICE_SOURCE[range] ?? PRICE_SOURCE["1y"];
  const sym = encodeURIComponent(symbol.toUpperCase());
  const res = await fetchStaticJson<Prices>(`/api/prices/${sym}?range=${src.file.range}&interval=${src.file.interval}`, signal);
  if (!res.ok) return res.status === 404 ? { ok: false, status: 404, message: `No stored prices for ${symbol.toUpperCase()} in the static snapshot` } : res;
  return { ok: true, data: slicePrices(res.data, range, src.months) };
}

// ---------------------------------------------------------------- search

interface UniverseRow {
  ticker: string;
  name: string;
  sector: string | null;
  industry?: string | null;
}

let universePromise: Promise<StaticResult<UniverseRow[]>> | null = null;

/** The exported universe (`companies.json`), loaded once per page and shared by every search box. */
function loadUniverse(): Promise<StaticResult<UniverseRow[]>> {
  if (!universePromise) {
    universePromise = fetchStaticJson<UniverseRow[]>("/api/companies").then((res) => {
      // Let a failed load be retried on the next keystroke.
      if (!res.ok) universePromise = null;
      return res;
    });
  }
  return universePromise;
}

/**
 * Static stand-in for `api.search()`: substring match on ticker / name / sector /
 * industry over the exported universe, tickers-first. No SEC registry fallthrough.
 */
export async function staticSearch(q: string, limit = 12): Promise<StaticResult<SearchResult[]>> {
  const res = await loadUniverse();
  if (!res.ok) return res;
  const needle = q.trim().toLowerCase();
  if (!needle) return { ok: true, data: [] };
  const score = (r: UniverseRow): number => {
    const t = r.ticker.toLowerCase();
    if (t === needle) return 0;
    if (t.startsWith(needle)) return 1;
    if (r.name.toLowerCase().startsWith(needle)) return 2;
    if (t.includes(needle) || r.name.toLowerCase().includes(needle)) return 3;
    if ((r.sector ?? "").toLowerCase().includes(needle) || (r.industry ?? "").toLowerCase().includes(needle)) return 4;
    return -1;
  };
  const hits = res.data
    .map((r) => ({ r, s: score(r) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.r.ticker.localeCompare(b.r.ticker))
    .slice(0, limit)
    .map(({ r }) => ({ ticker: r.ticker, name: r.name, sector: r.sector, in_universe: true }));
  return { ok: true, data: hits };
}
