/**
 * TypeScript mirrors of the payloads produced by backend/brain/engines/*.py and
 * served verbatim by backend/brain/api.py. Almost every metric can be null
 * (the engines use `r()` which returns None for missing/non-finite values),
 * so `Num` is used liberally.
 */
export type Num = number | null;

// ---------------------------------------------------------------- meta / health
export interface Meta {
  run_id: string;
  as_of: string;
  companies: number;
  themes: number;
  llm_provider: string | null;
  universe_limit: number | null;
  top: { ticker: string; opportunity: Num; gap: Num }[];
}

export interface Health {
  ok: boolean;
  latest_run: string | null;
  running: boolean;
  last_error: string | null;
  /** True while a morning-brief job (POST /api/brief/run) is in flight. Absent on older backends. */
  running_brief?: boolean;
  /** True while an attention refresh (POST /api/attention/run) is in flight. Absent on older backends. */
  running_attention?: boolean;
}

// ---------------------------------------------------------------- regime
export type DimKey = "growth" | "inflation" | "liquidity" | "rates";
export const DIM_KEYS: DimKey[] = ["growth", "inflation", "liquidity", "rates"];

export type RegimeName = "Goldilocks" | "Reflation" | "Stagflation" | "Contraction";
export const REGIME_NAMES: RegimeName[] = ["Goldilocks", "Reflation", "Stagflation", "Contraction"];

export interface Indicator {
  id: string;
  name: string;
  transform: string;
  value: Num;
  raw_value: Num;
  as_of: string;
  z_level: Num;
  z_momentum: Num;
  score: Num;
  weight: number;
}

export interface Dimension {
  score: Num;
  momentum: Num;
  indicators: Indicator[];
}

export interface RegimeHistoryPoint {
  date: string;
  probabilities: Partial<Record<RegimeName, Num>>;
  dimensions: Partial<Record<DimKey, Num>>;
}

export interface Regime {
  as_of: string;
  headline: string;
  dimensions: Partial<Record<DimKey, Dimension>>;
  regime: {
    label: RegimeName;
    description: string;
    probabilities: Partial<Record<RegimeName, Num>>;
    beneficiaries: string[];
  };
  trend: {
    window_days: number;
    probabilities_prior: Partial<Record<RegimeName, Num>>;
    probability_delta: Partial<Record<RegimeName, Num>>;
    dimension_delta: Partial<Record<DimKey, Num>>;
  };
  history: RegimeHistoryPoint[];
  notes: string[];
}

// ---------------------------------------------------------------- flows
export type FlowGroup = "sector" | "industry" | "factor" | "size" | "region" | "bond" | "commodity" | "crypto";
export const FLOW_GROUPS: FlowGroup[] = ["sector", "industry", "factor", "size", "region", "bond", "commodity", "crypto"];

export type FlowTrend = "accelerating" | "steady" | "decelerating";

export interface Instrument {
  symbol: string;
  name: string;
  sector: string | null;
  score: number;
  trend: FlowTrend;
  rs_1m: Num;
  rs_3m: Num;
  rs_6m: Num;
  rs_accel: Num;
  return_1m: Num;
  return_3m: Num;
  return_6m: Num;
  return_12m: Num;
  rel_volume: Num;
  money_flow: Num;
  above_200dma: boolean | null;
  last: Num;
  last_date: string;
}

export interface Flows {
  as_of: string;
  benchmark: {
    symbol: string;
    return_1m: Num;
    return_3m: Num;
    return_12m: Num;
    above_200dma: boolean | null;
  };
  groups: Partial<Record<FlowGroup, Instrument[]>>;
  sector_rotation: Record<string, number>;
  risk_appetite: Num;
  summary: string[];
  method: string;
}

// ---------------------------------------------------------------- themes
export interface ThemeConstraint {
  trend?: string | null;
  constraint?: string | null;
  solution?: string | null;
}

export interface ThemeMember {
  ticker: string;
  name: string;
  weight: number;
  order: number;
  reality: Num;
  pricing: Num;
  growth: Num;
  quality: Num;
  value: Num;
}

export interface ThemeBase {
  id: string;
  name: string;
  description: string | null;
  human_needs: string[];
  horizon_years: string | null;
  constraints: ThemeConstraint[];
  related_etfs: string[];
  trend: Num;
  pricing: Num;
  gap: Num;
  star: boolean;
  company_trend: Num;
  etf_flow: Num;
  growth: Num;
  n_companies: number;
}

/** Full theme as returned by /api/themes/{id} (recursive). */
export interface Theme extends ThemeBase {
  members: ThemeMember[];
  children: Theme[];
  /** Latest attention row for this theme; null/absent until the attention engine has run. */
  attention?: ThemeAttention | null;
}

/** Row as returned by /api/themes (no members/children, has top_members). */
export interface ThemeListRow extends ThemeBase {
  top_members: ThemeMember[];
  /** Attention score (0-100) from the latest attention snapshot; null/absent until it has run. */
  attention?: Num;
  attention_not_priced?: boolean;
}

/** Compact theme row embedded in /api/overview. */
export interface ThemeOverviewRow {
  id: string;
  name: string;
  trend: Num;
  pricing: Num;
  gap: Num;
  star: boolean;
  n_companies: number;
  horizon_years: string | null;
}

// ---------------------------------------------------------------- companies
export interface CompanyRow {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  size: string;
  price: Num;
  market_cap: Num;
  quality: Num;
  growth: Num;
  value: Num;
  acceleration: Num;
  theme: Num;
  flow: Num;
  total: Num;
  reality: Num;
  narrative: Num;
  pricing: Num;
  expectations_gap: Num;
  revenue_growth: Num;
  roic: Num;
  fcf_yield: Num;
  pe: Num;
  ev_sales: Num;
  return_3m: Num;
  top_theme: string | null;
  /** Attention score (0-100) from the latest attention snapshot; null/absent until it has run. */
  attention?: Num;
  crowded?: boolean;
  not_priced?: boolean;
}

export interface CompanyInfo {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  size: string;
  cik: string | null;
}

export interface CompanyScores {
  growth: Num;
  quality: Num;
  value: Num;
  acceleration: Num;
  price_momentum: Num;
  reality: Num;
  pricing: Num;
}

export type ComponentKey =
  | "structural_trend"
  | "capital_flow"
  | "acceleration"
  | "quality"
  | "valuation"
  | "estimate_revisions"
  | "management_commentary"
  | "narrative_acceleration"
  | "insider_institutional";

export interface Check {
  label: string;
  ok: boolean | null;
  evidence: string;
}

export type EpistemicKind = "observed_fact" | "consensus_expectation" | "ai_inference" | "speculative_hypothesis";

export interface LlmThesis {
  thesis: string;
  /** The LLM schema emits a plain string here (unlike the deterministic object). */
  market_expectation: string;
  what_market_misses: string[];
  catalysts: string[];
  risks: string[];
  thesis_break_conditions: string[];
  second_order_beneficiaries: string[];
  epistemic_labels: { statement: string; kind: EpistemicKind }[];
  confidence: Num;
}

export interface ThemeExposure {
  theme_id: string;
  theme: string;
  weight: number;
  order: number;
  effective: number;
}

export interface Strategist {
  ticker: string;
  opportunity_score: Num;
  components: Partial<Record<ComponentKey, Num>>;
  weights: Partial<Record<ComponentKey, number>>;
  coverage: Num;
  unavailable: Partial<Record<ComponentKey, string>>;
  reality: Num;
  narrative: Num;
  pricing: Num;
  expectations_gap: Num;
  macro_fit: Num;
  sector_rotation: Num;
  theme_pricing: Num;
  checks: Check[];
  thesis: string;
  market_expectation: { summary: string; evidence: string[] };
  what_market_misses: string[];
  catalysts: string[];
  risks: string[];
  thesis_break_conditions: string[];
  narrative_note: string | null;
  llm_enriched: boolean;
  llm?: LlmThesis | null;
  theme_exposures: ThemeExposure[];
}

export interface FundamentalsPoint {
  period_end: string;
  filed: string | null;
  revenue: Num;
  gross_profit: Num;
  operating_income: Num;
  net_income: Num;
  ebitda: Num;
  ocf: Num;
  capex: Num;
  fcf: Num;
  eps: Num;
  shares_diluted: Num;
  cash: Num;
  debt: Num;
  net_debt: Num;
  equity: Num;
  total_assets: Num;
  rnd: Num;
  sbc: Num;
  buybacks: Num;
  dividends: Num;
  gross_margin: Num;
  operating_margin: Num;
  net_margin: Num;
  fcf_margin: Num;
  fcf_conversion: Num;
  revenue_growth: Num;
  revenue_growth_prev: Num;
  revenue_acceleration: Num;
  eps_growth: Num;
  net_income_growth: Num;
  fcf_growth: Num;
  operating_margin_change: Num;
  roic: Num;
  incremental_roic: Num;
  roe: Num;
  roa: Num;
  net_debt_to_ebitda: Num;
  interest_coverage: Num;
  dilution: Num;
  sbc_pct_revenue: Num;
  tax_rate: Num;
}

export type MultipleKey = "pe" | "ev_ebitda" | "ev_sales" | "p_fcf";

export interface Valuation {
  market_cap?: Num;
  enterprise_value?: Num;
  pe?: Num;
  ev_ebitda?: Num;
  ev_sales?: Num;
  p_fcf?: Num;
  fcf_yield?: Num;
  earnings_yield?: Num;
  peg?: Num;
  buyback_yield?: Num;
  dividend_yield?: Num;
  shareholder_yield?: Num;
  percentile_vs_history?: Partial<Record<MultipleKey, Num>>;
  cheapness_vs_history?: Num;
  history_median?: Partial<Record<MultipleKey, Num>>;
}

export interface Momentum {
  return_1m?: Num;
  return_3m?: Num;
  return_6m?: Num;
  return_12m?: Num;
  pct_from_52w_high?: Num;
  above_200dma?: boolean | null;
  dist_200dma?: Num;
}

export interface Fundamentals {
  latest: Partial<FundamentalsPoint>;
  history: Partial<FundamentalsPoint>[];
  valuation: Valuation;
  momentum: Momentum;
  price: Num;
  data_quality: { ttm_quarters?: number; has_ocf?: boolean; has_operating_income?: boolean; last_filed?: string | null };
}

export interface CompanyDetail {
  company: CompanyInfo;
  scores: CompanyScores;
  strategist: Strategist;
  fundamentals: Fundamentals;
  /** Set when the row was pulled in via POST /api/companies/{ticker}/analyze rather than the weekly run. */
  on_demand?: boolean;
  /** ISO date the on-demand analysis ran (only with `on_demand`). */
  analyzed_at?: string;
  /** Latest attention row for this ticker; null/absent until the attention engine has run. */
  attention?: CompanyAttention | null;
  /** Trend-template read from the weekly run; null/absent when there were not enough price bars. */
  technical?: CompanyTechnical | null;
}

/** Criterion keys of the Minervini-style trend template (technicals.py `trend_template`). */
export type TrendCriterionKey =
  | "above_150_200"
  | "150_above_200"
  | "200_rising_1m"
  | "50_above_150_200"
  | "above_50"
  | "25pct_above_52w_low"
  | "within_25pct_of_52w_high"
  | "rs_positive_6m";

export const TREND_CRITERIA: { key: TrendCriterionKey; label: string }[] = [
  { key: "above_150_200", label: "Above 150 & 200-day" },
  { key: "150_above_200", label: "150 > 200" },
  { key: "200_rising_1m", label: "200-day rising 1m" },
  { key: "50_above_150_200", label: "50 > 150 & 200" },
  { key: "above_50", label: "Above 50-day" },
  { key: "25pct_above_52w_low", label: "≥25% above 52w low" },
  { key: "within_25pct_of_52w_high", label: "Within 25% of 52w high" },
  { key: "rs_positive_6m", label: "6m RS positive" },
];

/** Full trend-template payload as embedded in /api/companies/{ticker}. */
export interface CompanyTechnical {
  score: Num;
  passes: number;
  criteria: Partial<Record<TrendCriterionKey, boolean>> & Record<string, boolean>;
  ready: boolean;
  stage: TrendStage | string;
  close: Num;
  sma50: Num;
  sma150: Num;
  sma200: Num;
  pct_above_52w_low: Num;
  pct_from_52w_high: Num;
  rs_6m: Num;
  rsi14: Num;
  atr20: Num;
  atr_pct: Num;
  overbought: boolean;
  /** 150-day (30-week) average four weeks ago; null when history is short. */
  sma150_prev4w?: Num;
  /** True when the 30-week average is below where it was four weeks ago (Weinstein stage-3/4 warning). */
  sma150_declining?: boolean;
}

// ---------------------------------------------------------------- search / on-demand
/**
 * Row as returned by /api/search. Universe hits carry a sector; names resolved
 * through the SEC registry come back with `in_universe: false` and `sector: null`.
 */
export interface SearchResult {
  ticker: string;
  name: string;
  sector: string | null;
  in_universe: boolean;
  foreign_filer?: boolean;
}

/** Run header as returned by /api/runs (newest first). */
export interface RunRow {
  run_id: string;
  as_of: string;
  created_at: string;
}

// ---------------------------------------------------------------- risk
export interface RiskSignal {
  name: string;
  value: Num;
  z: Num;
  risk_score: Num;
  weight: number;
  note: string;
}

export interface Posture {
  baseline: Record<string, number>;
  recommended: Record<string, number>;
  beta_target: { baseline: Num; recommended: Num };
}

export interface Risk {
  as_of: string;
  risk_score: Num;
  label: string;
  signals: RiskSignal[];
  posture: Posture;
  hedges: string[];
  notes: string[];
}

// ---------------------------------------------------------------- overview
export interface Overview {
  meta: Meta;
  portfolio: PortfolioOverview | null;
  regime: {
    headline: string;
    label: RegimeName;
    probabilities: Partial<Record<RegimeName, Num>>;
    probability_delta: Partial<Record<RegimeName, Num>>;
    dimensions: Partial<Record<DimKey, Num>>;
    dimension_delta: Partial<Record<DimKey, Num>>;
    as_of: string;
  };
  risk: { score: Num; label: string; posture: Posture };
  rotation: Instrument[];
  flow_summary: string[];
  risk_appetite: Num;
  themes: ThemeOverviewRow[];
  top_companies: CompanyRow[];
  biggest_gaps: CompanyRow[];
}

// ---------------------------------------------------------------- portfolio
export type RuleOp = "<" | ">";

/** Thesis-break rule frozen at entry (strategist.break_rules). `current`/`triggered` are filled on re-evaluation. */
export interface EntryRule {
  id: string;
  label: string;
  metric: string;
  op: RuleOp;
  threshold: number;
  current: Num;
  consecutive?: number;
  theme_id?: string;
  and_negative_rs?: boolean;
  triggered?: boolean;
}

export type HoldingStatus = "new" | "held";

/** Stop ladder per position (portfolio.py `_stop_levels`). Prices in dollars; distance in percent points. */
export interface HoldingStops {
  initial_stop: Num;
  /** Null until the trail has activated (gain above `trail_activation_gain_pct`; 0 = always on) or when ATR is unavailable. */
  trailing_stop: Num;
  active_stop: Num;
  hard_stop: Num;
  stop_distance_pct: Num;
}

export type TrendStage = "stage2_uptrend" | "emerging" | "basing_or_downtrend";

/** Compact trend-template read embedded on each holding (subset of `CompanyTechnical`). */
export interface HoldingTechnical {
  score: Num;
  passes: number;
  stage: TrendStage | string;
  ready: boolean;
  rsi14: Num;
  atr_pct: Num;
  rs_6m: Num;
  pct_from_52w_high: Num;
}

export interface Holding {
  ticker: string;
  name: string;
  sector: string;
  top_theme: string | null;
  weight: number;
  dollars: Num;
  shares: Num;
  price: Num;
  conviction: Num;
  opportunity: Num;
  gap: Num;
  reality: Num;
  pricing: Num;
  quality: Num;
  growth: Num;
  value: Num;
  macro_fit: Num;
  rationale: string[];
  notes: string[];
  status: HoldingStatus;
  entered: string;
  entry_rules: EntryRule[];
  rule_status: EntryRule[] | null;
  prior_weight: Num;
  // ---- long-term mode (portfolio engine v2); absent on older snapshots ----
  entry_price?: Num;
  /** Percent points since entry (12.3 = +12.3%). */
  pnl_pct?: Num;
  trail_high?: Num;
  stops?: HoldingStops | null;
  /** Long-term theme conviction, 0-1. */
  lt_conviction?: Num;
  attention?: Num;
  narrative?: Num;
  technical?: HoldingTechnical | null;
  /** Consecutive morning-brief "trim/review" flags on this name. */
  brief_flags?: number;
  brief_notes?: string[];
  /** Consecutive runs the trend template scored below 50; exits at `rules.trend_fail_runs`. */
  tech_fail_runs?: number;
}

export interface Sleeve {
  symbol: string;
  name: string;
  sleeve: string;
  weight: number;
}

export type TradeAction = "BUY" | "SELL" | "ADD" | "TRIM";

export interface Trade {
  action: TradeAction;
  ticker: string;
  name: string | null;
  from: number;
  to: number;
  reason: string;
  dollars: Num;
}

export interface Exit {
  ticker: string;
  name: string | null;
  reason: string;
  prior_weight: number;
  rules?: EntryRule[];
  entry_price?: Num;
  exit_price?: Num;
  /** Percent points from entry to exit. */
  pnl_pct?: Num;
}

/** Candidate that qualified on conviction but failed the trend-template gate (long-term mode). */
export interface RejectedTechnical {
  ticker: string;
  reason: string;
  score: Num;
}

export interface Skipped {
  ticker: string;
  reason: string;
}

export interface WatchlistRow {
  ticker: string;
  name: string;
  opportunity: Num;
  gap: Num;
  conviction: Num;
  technical_score?: Num;
  lt_conviction?: Num;
}

export interface PortfolioStats {
  positions: number;
  weighted_opportunity: Num;
  weighted_gap: Num;
  weighted_reality: Num;
  weighted_pricing: Num;
  weighted_quality: Num;
  sector_weights: Record<string, number>;
  theme_weights: [string, number][];
  turnover: Num;
  /** Weight-averaged long-term conviction, 0-1. */
  weighted_lt_conviction?: Num;
  /** Weight-averaged distance to the active stop, percent points. */
  avg_stop_distance_pct?: Num;
  /** Weight-averaged P&L since entry, percent points. */
  book_pnl_pct?: Num;
}

/** Shape = MEMO_SCHEMA in backend/brain/llm.py. */
export interface PortfolioMemo {
  summary: string;
  key_bets: { ticker: string; why: string }[];
  concentrations: string[];
  biggest_risks: string[];
  what_would_change_our_mind: string[];
  hedging_note: string;
  watchlist: string[];
  confidence: Num;
}

export interface Portfolio {
  as_of: string;
  portfolio_value: number;
  /** RULES dict; v2 adds string (`mode`), boolean (`technical_required`, `regime_gate`) and list (`drawdown_ladder`) entries. */
  rules: Record<string, RuleValue>;
  equity_weight: Num;
  beta_target: Num;
  risk_label: string | null;
  regime: string | null;
  holdings: Holding[];
  sleeves: Sleeve[];
  trades: Trade[];
  exits: Exit[];
  skipped: Skipped[];
  watchlist: WatchlistRow[];
  stats: PortfolioStats;
  is_initial: boolean;
  prior_as_of: string | null;
  memo?: PortfolioMemo | null;
  // ---- long-term mode (portfolio engine v2); absent on older snapshots ----
  /** Equity ceiling from the Risk engine's posture (fraction). */
  equity_cap?: Num;
  cash_weight?: Num;
  longterm_thesis?: string | null;
  /** [theme name, conviction 0-1] for the top long-term themes. */
  longterm_top_themes?: [string, number][];
  rejected_technical?: RejectedTechnical[];
  /** True when stop-outs this run reached `cooldown_stopouts`; new entries pause. */
  cooldown?: boolean;
  stopouts?: number;
  /** Book NAV index, 1.0 at inception. */
  nav_index?: Num;
  nav_peak?: Num;
  /** Percent points below the NAV peak (negative when below). */
  drawdown_pct?: Num;
  /** Book return since the prior snapshot, percent points. */
  period_return_pct?: Num;
  /** Turtle drawdown-ladder step in effect (risk/cap multipliers), null when none. */
  ladder_note?: string | null;
  regime_gate?: RegimeGate | null;
}

/** RULES values: numbers, the mode string, booleans, or the drawdown ladder `[[dd%, risk mult, cap mult], ...]`. */
export type RuleValue = number | string | boolean | number[][];

/** Faber 10-month SMA + Antonacci 12m-vs-T-bills gate on SPY (pipeline.py). Detail fields absent when history is short. */
export interface RegimeGate {
  open: boolean;
  /** False when `rules.regime_gate` is off (the gate is reported but not enforced). */
  applied: boolean;
  price?: Num;
  sma_10m?: Num;
  above_sma?: boolean;
  return_12m_pct?: Num;
  tbill_pct?: Num;
  beats_tbills?: boolean;
  note: string;
}

/** Row as returned by /api/portfolio/history (newest first). */
export interface PortfolioHistoryRow {
  run_id: string;
  as_of: string;
  positions: number;
  equity_weight: Num;
  trades: number;
  exits: number;
  weighted_opportunity: Num;
  weighted_gap: Num;
  turnover: Num;
  holdings: string[];
  has_memo: boolean;
}

/** Compact portfolio summary embedded in /api/overview. */
export interface PortfolioOverview {
  positions: number;
  equity_weight: Num;
  trades: number;
  weighted_gap: Num;
  top: { ticker: string; weight: number }[];
}

// ---------------------------------------------------------------- prices
export type PriceRange = "1m" | "3m" | "6m" | "1y" | "2y" | "5y";
export type PriceInterval = "1d" | "1w";

/** One OHLCV bar as served by /api/prices/{symbol}; `t` is "YYYY-MM-DD". */
export interface PriceBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Indicator arrays aligned 1:1 with `bars` (null while the window is warming up). */
export interface PriceIndicators {
  sma20: Num[];
  sma50: Num[];
  sma200: Num[];
  ema21: Num[];
  bb_upper: Num[];
  bb_lower: Num[];
  rsi14: Num[];
  macd: Num[];
  macd_signal: Num[];
  macd_hist: Num[];
}

export interface PriceLatest {
  close: number;
  change_1d_pct: Num;
  change_range_pct: Num;
  sma20: Num;
  sma50: Num;
  sma200: Num;
  rsi14: Num;
  macd_hist: Num;
  above_200dma: boolean | null;
  pct_from_52w_high: Num;
  avg_volume_20: Num;
  /** e.g. ["Above 200-day", "Golden cross", "RSI overbought"] */
  signals: string[];
}

/** Payload of /api/prices/{symbol}?range=&interval= (404 when the symbol has no stored prices). */
export interface Prices {
  symbol: string;
  range: string;
  interval: string;
  n: number;
  bars: PriceBar[];
  indicators: PriceIndicators;
  latest: PriceLatest;
}

// ---------------------------------------------------------------- morning brief
export type BriefDirection = "risk-on" | "neutral" | "risk-off";
export type SignalDirection = "bullish" | "bearish" | "neutral";
export type BriefAction = "hold" | "review" | "add" | "trim";

export interface BriefSource {
  name: string;
  url: string;
  n: number;
  ok: boolean;
}

export interface BriefHeadline {
  title: string;
  source: string;
  url: string;
  published: string | null;
  tickers: string[];
  themes: string[];
}

export interface BriefCluster {
  theme_id: string;
  theme: string;
  n: number;
  headlines: { title: string; source: string; url: string }[];
}

export interface BriefTickerMention {
  ticker: string;
  name: string;
  n: number;
  in_portfolio: boolean;
}

export interface BriefClaim {
  claim: string;
  horizon: string;
  beneficiaries: string[];
  risks: string[];
  confidence: number;
  kind: EpistemicKind;
}

export interface BriefThemeSignal {
  theme_id: string;
  theme: string;
  direction: SignalDirection;
  strength: number;
  evidence: string;
}

export interface BriefTickerSignal {
  ticker: string;
  direction: SignalDirection;
  evidence: string;
}

export interface BriefPortfolioImplication {
  ticker: string;
  action: BriefAction;
  why: string;
}

/** LLM section of the brief; null when no ANTHROPIC_API_KEY is configured. */
export interface BriefLlm {
  summary: string;
  market_thesis: {
    direction: BriefDirection;
    short_term: string;
    medium_term: string;
    long_term: string;
    confidence: number;
  };
  human_behavior: { short_term: string[]; long_term: string[] };
  claims: BriefClaim[];
  theme_signals: BriefThemeSignal[];
  ticker_signals: BriefTickerSignal[];
  portfolio_implications: BriefPortfolioImplication[];
  watch_today: string[];
  what_changed_since_yesterday: string[];
}

/** Payload of /api/brief (404 "No brief yet" until one has been generated). */
export interface Brief {
  n_headlines?: number;
  brief_id: string;
  as_of: string;
  generated_at: string;
  llm_provider: string | null;
  sources: BriefSource[];
  /** Deduped, newest first, up to ~150. */
  headlines: BriefHeadline[];
  /** Grouped by theme, n desc. */
  clusters: BriefCluster[];
  ticker_mentions: BriefTickerMention[];
  llm: BriefLlm | null;
  /** 0-100 narrative score per theme_id over the last 7 briefs (empty without an LLM). */
  narrative: { by_theme: Record<string, number> };
}

/** Row as returned by /api/brief/history (newest first). */
export interface BriefHistoryRow {
  brief_id: string;
  as_of: string;
  generated_at: string;
  n_headlines: number;
  direction: string | null;
  has_llm: boolean;
}

// ---------------------------------------------------------------- attention
/**
 * Payloads of backend/brain/engines/attention.py. Percent fields
 * (`*_vs_28d_pct`, `*_vs_1y_pct`) are already in percent points; `st_bullish_share` is a fraction.
 */
export interface AttentionSourceStatus {
  ok: boolean;
  n: number;
}

export interface CompanyAttention {
  ticker: string;
  name: string;
  sector: string;
  attention: Num;
  /** Number of sources that contributed to the blend. */
  breadth: number;
  pricing: Num;
  price_momentum: Num;
  opportunity: Num;
  gap: Num;
  crowded: boolean;
  not_priced: boolean;
  wiki_title: string | null;
  wiki_7d: Num;
  wiki_vs_28d_pct: Num;
  wiki_vs_1y_pct: Num;
  wiki_z: Num;
  st_watchers: Num;
  st_msgs_per_day: Num;
  st_bullish_share: Num;
  st_watchers_vs_28d_pct: Num;
  st_history_days: Num;
  /** Per-source 0-100 score (null when the source had no usable history). */
  sources: Record<string, Num>;
}

export interface ThemeAppRank {
  name: string;
  rank: number | null;
}

export interface ThemeYoutube {
  last7: number;
  vs_28d_pct: number;
  score: number;
}

export interface ThemeAttention {
  theme_id: string;
  name: string;
  attention: Num;
  breadth: number;
  trend: Num;
  pricing: Num;
  narrative: Num;
  gap: Num;
  not_priced: boolean;
  wiki_7d: Num;
  wiki_vs_28d_pct: Num;
  wiki_vs_1y_pct: Num;
  wiki_z: Num;
  wiki_articles: string[];
  app_ranks: ThemeAppRank[];
  gh_repos: Num;
  youtube: ThemeYoutube | null;
  rising_queries: string[];
  sources: Record<string, Num>;
}

/** Movers entries mix both shapes; tell them apart by `ticker` vs `theme_id`. */
export type AttentionEntity = CompanyAttention | ThemeAttention;

export function isCompanyAttention(x: AttentionEntity): x is CompanyAttention {
  return "ticker" in x;
}

/** Payload of /api/attention (404 "No attention snapshot yet" until the engine has run). */
export interface Attention {
  as_of: string;
  generated_at: string;
  sources: Record<string, AttentionSourceStatus>;
  weights: Record<string, number>;
  companies: CompanyAttention[];
  themes: ThemeAttention[];
  movers: {
    companies_up: CompanyAttention[];
    companies_down: CompanyAttention[];
    themes_up: ThemeAttention[];
    not_priced: AttentionEntity[];
    crowded: CompanyAttention[];
  };
  method: string;
}

// ---------------------------------------------------------------- long-term thesis
/**
 * Payloads of backend/brain/engines/longterm.py `build()` served by /api/thesis.
 * Convictions and confidence are fractions (0-1).
 */
export type ShiftTrend = "strengthening" | "stable" | "fading";

export interface StructuralShift {
  shift: string;
  human_need: string;
  horizon_years: string;
  confidence: number;
  trend: ShiftTrend;
  /** Theme ids (or names) the shift maps to. */
  themes: string[];
  evidence: string[];
  kind: EpistemicKind;
}

export interface ThemeRankingRow {
  theme_id: string;
  theme: string;
  /** 0-1 long-term conviction. */
  conviction: number;
  why: string;
}

export interface NotPricedCandidate {
  ticker: string;
  why: string;
}

/** Payload of /api/thesis (404 "No long-term thesis yet" until one has been built). */
export interface Thesis {
  as_of: string;
  generated_at: string;
  n_briefs: number;
  observation_dates: string[];
  llm_provider: string | null;
  thesis: string;
  structural_shifts: StructuralShift[];
  theme_ranking: ThemeRankingRow[];
  beneficiary_profiles: string[];
  not_priced_candidates: NotPricedCandidate[];
  anti_theses: string[];
  what_would_change: string[];
  confidence: number;
  theme_conviction: Record<string, number>;
}

/** Row as returned by /api/thesis/history (newest first). */
export interface ThesisHistoryRow {
  id: string;
  as_of: string;
  n_briefs: number;
  confidence: Num;
  /** [theme name, conviction] for the top 5 themes. */
  top_themes: [string, number][];
  llm: string | null;
}
