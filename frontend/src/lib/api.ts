import type {
  Attention,
  Brief,
  BriefHistoryRow,
  CompanyDetail,
  CompanyRow,
  Flows,
  Health,
  Overview,
  Portfolio,
  PortfolioHistoryRow,
  PriceInterval,
  PriceRange,
  Prices,
  Regime,
  Risk,
  RunRow,
  SearchResult,
  Theme,
  ThemeListRow,
  Thesis,
  ThesisHistoryRow,
  ThesisV2,
  ThesisV2List,
} from "./types";
import { IS_STATIC, staticFileFor } from "./static";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string };

/**
 * Static export, server side (i.e. `next build` prerendering): read the endpoint's
 * exported file from public/data instead of calling the API. Same contract as a
 * live request — a missing file is a 404 `{ ok: false }`, anything else a null-status
 * failure, never a throw. The Node built-ins are imported lazily with bundler
 * ignore hints so this module stays importable from client components.
 */
async function readStaticJson<T>(path: string): Promise<ApiResult<T>> {
  const rel = staticFileFor(path);
  try {
    const [fs, nodePath] = await Promise.all([
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "node:fs/promises"),
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "node:path"),
    ]);
    const file = nodePath.join(process.cwd(), "public", "data", ...rel.split("/"));
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, status: 404, message: `Not in the static snapshot (${rel})` };
      }
      throw e;
    }
    return { ok: true, data: JSON.parse(raw) as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, status: null, message: `Could not read the static snapshot for ${path} (${message})` };
  }
}

/**
 * Request against the FastAPI backend (server components and browser alike).
 * Never throws: a down backend or a 404 "No snapshot yet" both come back as
 * `{ ok: false }` so pages can render an empty state instead of crashing.
 * In the static export (NEXT_PUBLIC_STATIC=1) server-side calls read the
 * pre-exported JSON from public/data instead; see readStaticJson.
 */
async function request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  if (IS_STATIC && typeof window === "undefined") return readStaticJson<T>(path);
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { detail?: unknown };
        if (body && body.detail) message = String(body.detail);
      } catch {
        /* body wasn't JSON */
      }
      return { ok: false, status: res.status, message };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, status: null, message: `Could not reach the API at ${API_BASE} (${message})` };
  }
}

function get<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  return request<T>(path, init);
}

function post<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  return request<T>(path, { method: "POST", ...init });
}

export interface CompaniesQuery {
  sector?: string;
  sort?: string;
  limit?: number;
}

export const api = {
  health: () => get<Health>("/api/health"),
  overview: () => get<Overview>("/api/overview"),
  regime: () => get<Regime>("/api/regime"),
  flows: () => get<Flows>("/api/flows"),
  risk: () => get<Risk>("/api/risk"),
  themes: () => get<ThemeListRow[]>("/api/themes"),
  theme: (id: string) => get<Theme>(`/api/themes/${encodeURIComponent(id)}`),
  companies: (q: CompaniesQuery = {}) => {
    const p = new URLSearchParams();
    if (q.sector) p.set("sector", q.sector);
    if (q.sort) p.set("sort", q.sort);
    if (q.limit) p.set("limit", String(q.limit));
    const qs = p.toString();
    return get<CompanyRow[]>(`/api/companies${qs ? `?${qs}` : ""}`);
  },
  company: (ticker: string) => get<CompanyDetail>(`/api/companies/${encodeURIComponent(ticker.toUpperCase())}`),
  portfolio: () => get<Portfolio>("/api/portfolio"),
  portfolioHistory: () => get<PortfolioHistoryRow[]>("/api/portfolio/history"),
  runs: () => get<RunRow[]>("/api/runs"),
  /** Ticker/name search: universe first, then the SEC registry (`in_universe: false`). */
  search: (q: string, limit = 12, signal?: AbortSignal) => {
    const p = new URLSearchParams({ q, limit: String(limit) });
    return get<SearchResult[]>(`/api/search?${p.toString()}`, { signal });
  },
  /** Pull any SEC-registered ticker into the current run (3-10 s). 422 = cannot be scored, with a reason in `message`. */
  analyze: (ticker: string) => post<CompanyDetail>(`/api/companies/${encodeURIComponent(ticker.toUpperCase())}/analyze`),
  /** OHLCV bars + indicators for one symbol. 404 = no stored prices for that symbol. */
  prices: (symbol: string, range: PriceRange = "1y", interval: PriceInterval = "1d", signal?: AbortSignal) => {
    const p = new URLSearchParams({ range, interval });
    return get<Prices>(`/api/prices/${encodeURIComponent(symbol.toUpperCase())}?${p.toString()}`, { signal });
  },
  /** Latest morning brief. 404s with "No brief yet" until one has been generated. */
  brief: () => get<Brief>("/api/brief"),
  /** Per-brief summaries, newest first (empty list until a brief has run). */
  briefHistory: () => get<BriefHistoryRow[]>("/api/brief/history"),
  /** Kick off a brief in the background; poll /api/health `running_brief` until false. */
  runBrief: () => post<{ started: boolean; reason?: string }>("/api/brief/run"),
  /** Latest attention snapshot. 404s with "No attention snapshot yet" until the engine has run. */
  attention: () => get<Attention>("/api/attention"),
  /** Kick off an attention refresh in the background; poll /api/health `running_attention` until false. */
  runAttention: () => post<{ started: boolean; reason?: string }>("/api/attention/run"),
  /** Latest long-term thesis. 404s with "No long-term thesis yet" until the morning run has built one. */
  thesis: () => get<Thesis>("/api/thesis"),
  /** Per-build thesis summaries, newest first (empty list until one has been built). */
  thesisHistory: () => get<ThesisHistoryRow[]>("/api/thesis/history"),
  /** Thesis v2 ledger + scoreboard (Causal Futures Engine). `theses` is empty until one has been analysed. */
  thesisV2List: () => get<ThesisV2List>("/api/thesis-v2"),
  /** One Thesis v2 record. 404s with "No thesis {id}" until it has been analysed. */
  thesisV2: (id: string) => get<ThesisV2>(`/api/thesis-v2/${encodeURIComponent(id.toUpperCase())}`),
  /** Analyse a new thesis statement in the background (3-5 min); poll /api/health `running_thesis_v2` until false. 422 = statement too short. */
  createThesisV2: (statement: string) =>
    post<{ started: boolean; reason?: string }>("/api/thesis-v2", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement }),
    }),
  /** Monthly "what changed?" review of one thesis in the background; poll /api/health `running_thesis_v2` until false. */
  updateThesisV2: (id: string) =>
    post<{ started: boolean; reason?: string }>(`/api/thesis-v2/${encodeURIComponent(id.toUpperCase())}/update`),
  /** Resolve a thesis (synchronous): freezes the record and Brier-scores it. Returns the updated record. */
  resolveThesisV2: (id: string, outcome: boolean) =>
    post<ThesisV2>(`/api/thesis-v2/${encodeURIComponent(id.toUpperCase())}/resolve`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    }),
};

/** Latest model-portfolio snapshot. 404s with "No portfolio snapshot yet" until the pipeline has run. */
export const getPortfolio = api.portfolio;
/** Per-run portfolio summaries, newest first (empty list until the pipeline has run). */
export const getPortfolioHistory = api.portfolioHistory;
