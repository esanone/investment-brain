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
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string };

/**
 * Request against the FastAPI backend (server components and browser alike).
 * Never throws: a down backend or a 404 "No snapshot yet" both come back as
 * `{ ok: false }` so pages can render an empty state instead of crashing.
 */
async function request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
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
};

/** Latest model-portfolio snapshot. 404s with "No portfolio snapshot yet" until the pipeline has run. */
export const getPortfolio = api.portfolio;
/** Per-run portfolio summaries, newest first (empty list until the pipeline has run). */
export const getPortfolioHistory = api.portfolioHistory;
