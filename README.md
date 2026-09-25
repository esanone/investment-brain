# Investment Intelligence Engine

A system of specialised engines feeding one question:

> **Where are capital, economic activity, technology adoption and human behaviour moving
> before that movement is fully reflected in asset prices?**

The intellectual centre is the split between three scores for every company and theme:

| Score | Question | Phase-1 inputs |
|---|---|---|
| **Reality** | What is actually happening? | Fundamentals (growth, quality, acceleration) + macro fit + capital flows |
| **Narrative** | What do investors believe is happening? | *Phase 2* (news, transcripts, X/Reddit, analyst language) |
| **Pricing** | How much is already reflected in price? | Valuation vs own history and sector peers, momentum, proximity to highs |

**Expectations gap = Reality − Pricing** (minus Narrative once measured). Stars (★) mark themes where
trend strength materially exceeds what the market appears to price.

## Phase 1 — what is built

Four agents, ~150 companies across 11 sectors, 29 structural themes, zero required API keys.

| Engine | Module | Source | Output |
|---|---|---|---|
| Economic Regime | `backend/brain/engines/regime.py` | FRED (27 series) | Growth / Inflation / Liquidity / Rates 0-100, regime **probabilities**, 60-day trend, 24-month history |
| Capital Flow | `backend/brain/engines/flows.py` | ETF prices & volume (sector, industry, factor, size, region, bond, commodity, crypto) | Capital Rotation Score −100..+100, RS acceleration, risk appetite, plain-language summary |
| Company Intelligence | `backend/brain/engines/fundamentals.py` | SEC EDGAR XBRL (point-in-time) + prices | Growth, profitability, cash generation, capital structure, ROIC, valuation vs own 5-year history and peers |
| Theme Knowledge Graph | `backend/brain/engines/themes.py`, `backend/brain/themes.yaml` | Company exposures + related ETF flows | Theme Trend vs Market Pricing, stars, constraint chains (Trend → Constraint → Required solution) |
| Investment Strategist | `backend/brain/engines/strategist.py` | Everything above | Opportunity Score (spec weights, Phase-2 inputs disclosed as unavailable), Reality / Narrative / Pricing, expectations gap, "why the model likes it", thesis, market expectation, what may be missed, catalysts, risks, **thesis-break conditions** |
| Risk / Hedging | `backend/brain/engines/risk.py` | VIX, credit spreads, curve, breadth, dollar, correlations, regime | Risk regime + recommended portfolio posture and beta target |
| LLM enrichment (optional) | `backend/brain/llm.py` | OpenAI or Anthropic, structured output | Sharper thesis, second-order beneficiaries, statements labelled fact / consensus / inference / hypothesis |

## Run it

```bash
# 1. Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # set SEC_USER_AGENT="Your Name you@example.com" (SEC requires it)
.venv/bin/python -m brain.pipeline run --limit 20 --no-llm   # quick first run (~3 min)
.venv/bin/python -m brain.pipeline run                       # full universe (~10 min first time, cached afterwards)
.venv/bin/uvicorn brain.api:app --port 8000

# 2. Frontend
cd ../frontend
npm install
npm run dev                     # http://localhost:3000  (NEXT_PUBLIC_API_URL defaults to http://localhost:8000)
```

Every run writes immutable snapshots (`snapshots` table) keyed by run id, so the API is a pure
reader and score history accumulates for back-testing the scores themselves.
`POST /api/run` re-runs the pipeline in the background; the dashboard has a button for it.

## Data sources (all free)

| Source | Used for | Key |
|---|---|---|
| SEC EDGAR `companyfacts` | 10-K / 10-Q financials, share counts | none (descriptive User-Agent required) |
| FRED | 27 macro series (growth, inflation, liquidity, rates, VIX) | optional `FRED_API_KEY`; public CSV export used otherwise |
| Nasdaq historical / Yahoo chart | Daily prices for ~225 symbols (stocks, ETFs, crypto) | none |

Point-in-time discipline: XBRL values are taken from the *earliest* filing that reported them
(what the market knew first); Q4 is derived as FY − (Q1+Q2+Q3); per-share metrics use split-adjusted
restatements; valuation history uses only financials filed before each date. FRED vintages (ALFRED)
are the Phase-2 upgrade for revision-aware back-tests.

## Configuration

See `backend/.env.example`. Defaults: SQLite at `backend/data/brain.db`; set `DATABASE_URL` to a
Postgres/Supabase URL for production (pgvector will host the Narrative engine's embeddings).

## Layout

```
backend/brain/
  config.py  db.py  models.py      settings, SQLAlchemy, tables (companies, instruments, prices,
                                   macro_observations, fundamentals, themes, theme_exposures, snapshots)
  universe.py  themes.yaml         Phase-1 universe and the theme knowledge graph
  data/{fred,edgar,prices,http}.py fetchers with on-disk caching
  engines/                         regime, flows, fundamentals, themes, strategist, risk, common
  llm.py  pipeline.py  api.py      optional enrichment, orchestration CLI, FastAPI
frontend/                          Next.js dashboard: /, /regime, /flows, /themes, /companies, /risk
```

## Phase 2 backlog (in the order the scores need them)

1. Narrative Intelligence Engine: claim extraction from news / transcripts / X / Reddit into pgvector; feeds the Narrative score and "narrative acceleration".
2. Earnings Intelligence Engine: transcript + 10-Q deltas → guidance changes, management language, second-order beneficiaries.
3. Estimate revisions, Form 4 insider and 13F institutional flows → the four Opportunity-Score components currently marked unavailable.
4. Intrinio ETF fund flows to replace the price/volume flow proxy; ALFRED vintages; Prefect scheduling.

## Portfolio engine and weekly recalibration

`backend/brain/engines/portfolio.py` turns the ranking into a model portfolio and recalibrates it on every run:

1. **Entry filter**: opportunity ≥ 55, expectations gap ≥ 0, at least 8 TTM observations.
2. **Conviction** = (opportunity − 50) × (1 + gap/50), tilted by macro fit; half-sized while a name is in a
   deep downtrend; incumbents get a 15% bonus so the book does not churn on noise.
3. **Caps**: max 20 positions, 8% per position, 30% per sector, 35% per theme. The equity sleeve is sized by the
   Risk engine's posture; the rest goes to Treasury / cash / gold / credit / commodity ETF proxies.
4. **Thesis-break rules are frozen at entry** (revenue-growth floor, ROIC floor, margin compression, sector rotation,
   adverse-regime odds, trend break, theme trend) and re-evaluated every run. A breached rule forces an exit and
   the reason is recorded.
5. **Trades** vs the prior portfolio (BUY / SELL / ADD / TRIM with dollar amounts) and a watchlist of the next names up.
6. With an LLM key, every holding's thesis is enriched and a **weekly memo** is written (key bets, concentrations,
   what would change our mind, watchlist).

Set `PORTFOLIO_VALUE` in `.env` (default 100000) for share counts. Recalibrate with `scripts/weekly.sh`
(schedule it with cron or launchd for Monday mornings), or the dashboard's Run button. Every portfolio is a
snapshot, so `/api/portfolio/history` gives the full audit trail of what the system held and why it changed.

## Search and on-demand tickers

The search box (press `/`) matches the universe first, then falls through to the SEC's full ticker registry
(~10,000 names). A ticker outside the universe can be pulled in from its page with **Analyze on demand**:
the backend resolves it through EDGAR, classifies its sector from the SIC code, ingests its filings and prices,
scores it against the current run's universe (same percentile scale), and adds it to every future weekly run
(`companies.source = custom`). Names that cannot be scored get a plain reason instead of a silent blank:
pre-revenue companies (no revenue in XBRL, e.g. OKLO) and foreign private issuers (20-F/40-F filers, e.g. NVO)
are the two current gaps.

## Morning brief (Narrative engine, step 1) and charts

`python -m brain.pipeline brief` reads 14 key-free news feeds (CNBC, MarketWatch, Yahoo Finance, WSJ Markets,
FT Markets, the Federal Reserve, and Google News topic queries), de-duplicates ~600 headlines, maps them to the
theme graph and the universe, and (with an LLM key) extracts claims about the future with horizon, beneficiaries,
risks and an epistemic label, a market thesis (short / medium / long term, risk-on / neutral / risk-off), how human
behaviour is shifting, theme and ticker signals, and implications for each portfolio holding. Theme narrative scores
roll up from the last 7 briefs and become the **Narrative** score on themes and companies.

`python -m brain.pipeline morning` = brief, then a full recalibration with today's narrative folded in.
Schedule `scripts/morning.sh` for weekday mornings (cron line in the file). Each brief is a snapshot
(`/api/brief/history`), so yesterday's thesis is handed to today's model for "what changed".

Every company page has a price chart (candles or line; 1M–5Y; SMA 20/50/200, EMA 21, Bollinger, volume, RSI,
MACD) served by `/api/prices/{symbol}`; the same indicators feed the LLM's technical read in each thesis.

## Attention engine (what people are looking up, watching, installing and building)

`python -m brain.pipeline attention` collects, key-free: Wikipedia daily pageviews for every company and for
each theme's article basket, Stocktwits watchers and message velocity per ticker, Apple's top-100 free apps
(mapped to themes and platforms), GitHub topic adoption for developer themes, and Google autocomplete for rising
sub-topics (YouTube video velocity joins when `YOUTUBE_API_KEY` is set). Each source is scored as acceleration
from the entity's own trailing year; Attention is the weighted blend, Breadth counts sources rising together.
Two flags matter: **not_priced** (attention rising while Pricing is still low) and **crowded** (extreme attention
with extreme price momentum). The morning flow runs attention first, so the brief's human-behaviour read sees
what the public is searching for. Sources without public history (Stocktwits, app ranks, GitHub) accumulate
from our own daily observations and start contributing after three weeks.

## Daily automation (ready before the open)

`python -m brain.pipeline morning` runs, in order: **attention** (what the public is searching, watching, installing)
→ **brief** (news → claims, market thesis, human-behaviour shifts, theme/ticker signals) → **long-term thesis**
(every brief's long-term observations reconciled into one thesis and a theme conviction ranking) → **recalibration**
(data refresh, all engines, portfolio v2). It takes ~30 minutes and about $4 of API usage.

Install the weekday 06:15 schedule as a macOS LaunchAgent:

```bash
./scripts/install_schedule.sh
```

The job only fires while the Mac is awake and you are logged in. Either keep it awake (`sudo pmset repeat wakeorpoweron
MTWRF 06:10:00`) or, for a machine-independent schedule, host the backend on Railway/Render with the same command as a
cron job. Logs go to `backend/data/morning.log`; the dashboard reads the latest snapshots whenever it is opened.

## Portfolio engine v2 (long-term mode)

Rules are taken from sourced practitioner and academic work (Minervini, Weinstein, O'Neil, Faber, Antonacci, the
Turtle rules, Kaminski & Lo, Han-Zhou-Zhu, Thorp, Marks); the research brief with sources is in `docs/risk-rules.md`.

| Question | Rule | Source |
|---|---|---|
| Is the market investable | Regime gate: S&P 500 above its 10-month average **and** 12-month return above T-bills; closed → no new entries and the equity cap halves | Faber 2007; Antonacci 2012 |
| What to own | Conviction = (opportunity − 50) × (1 + gap/50) × long-term theme conviction from the Human Future engine (0.7–1.3×) × attention flags (not-priced +15%, crowded −25%) × macro fit | this system |
| When to buy | Trend template ≥ 6/8 (above rising 150/200-day, 50 > 150 > 200, ≥25% off the 52-week low, within 25% of the high, positive 6-month RS); no entries within ~5 days of an expected earnings print; extended names (RSI ≥ 75) half-sized | Minervini; Weinstein Stage 2 |
| How much | Equal risk: 1% of the book per position ÷ distance to the stop, scaled by conviction; 5% cap at initiation, 8% max, 25% per sector, 35% per theme; the Risk engine's equity posture is a cap and cash absorbs what does not qualify | Turtles / Hite; 1940-Act style caps; Marks on cash |
| When to sell | Frozen thesis-break rules; initial stop = max(2 × ATR20, 8%) capped at 12%; Chandelier trail (highest close − 3 × ATR, never lowered); Stage-4 exit when price closes below a declining 30-week average; trend template failing two runs running; 26-week time stop if under water and below the 200-day; two consecutive brief trim/review calls halve, three exit; sell ⅓ into strength at +35% with RSI ≥ 75 | O'Neil, Minervini, LeBeau, Weinstein, Han-Zhou-Zhu |
| Book-level | NAV index tracked per run; Turtle ladder: −10% drawdown → risk per position ×0.5 and equity cap ×0.8, −20% → ×0.25 and ×0.64; after 3+ stop-outs in one run, new entries half-sized | Original Turtle rules; Tudor Jones |
