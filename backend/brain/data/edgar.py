"""SEC EDGAR: company facts (XBRL) -> standardised, point-in-time financials.

No API key needed; the SEC only asks for a descriptive User-Agent and <=10 req/s.

The tricky part is turning XBRL facts into clean single-quarter values:
  * a 10-Q reports the quarter *and* the year-to-date figure, and its comparatives
    from last year carry the *current* fiscal year in `fy`, so we key on (start, end)
    and keep the earliest-filed value for each period (what the market knew first);
  * Q4 is rarely reported on its own, so Q4 = FY - (Q1 + Q2 + Q3);
  * missing Q2/Q3 are recovered from YTD figures (Q2 = 6M - Q1, Q3 = 9M - 6M).
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from ..config import settings
from .http import cached_get_json

_HEADERS = {"User-Agent": settings.sec_user_agent, "Accept-Encoding": "gzip, deflate"}
_last_request = 0.0

# metric -> (kind, [tag candidates in priority order])
# kind: dur (duration / flow) | inst (instant / balance sheet)
TAGS: dict[str, tuple[str, list[str]]] = {
    "revenue": ("dur", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
                        "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense",
                        "TotalRevenuesAndOtherIncome", "OperatingLeasesIncomeStatementLeaseRevenue"]),
    "cogs": ("dur", ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"]),
    "gross_profit": ("dur", ["GrossProfit"]),
    "operating_income": ("dur", ["OperatingIncomeLoss"]),
    "pretax_income": ("dur", ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                              "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
                              "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"]),
    "tax": ("dur", ["IncomeTaxExpenseBenefit"]),
    "net_income": ("dur", ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"]),
    "eps_diluted": ("dur", ["EarningsPerShareDiluted", "EarningsPerShareBasic"]),
    "shares_diluted": ("dur", ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
                               "WeightedAverageNumberOfSharesOutstandingBasic"]),
    "ocf": ("dur", ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]),
    "capex": ("dur", ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
                      "PaymentsForCapitalImprovements", "PaymentsToAcquireOtherPropertyPlantAndEquipment"]),
    "da": ("dur", ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet",
                   "Depreciation", "DepreciationAmortizationAndOther"]),
    "interest_expense": ("dur", ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense",
                                 "InterestExpenseNet"]),
    "rnd": ("dur", ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"]),
    "sbc": ("dur", ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"]),
    "buybacks": ("dur", ["PaymentsForRepurchaseOfCommonStock"]),
    "dividends": ("dur", ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"]),
    "cash": ("inst", ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"]),
    "short_investments": ("inst", ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
                                   "DebtSecuritiesAvailableForSaleCurrent"]),
    "debt_lt": ("inst", ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt",
                         "LongTermDebtAndFinanceLeasesNoncurrent"]),
    "debt_st": ("inst", ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings", "LongTermDebtAndCapitalLeaseObligationsCurrent",
                         "CommercialPaper"]),
    "equity": ("inst", ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]),
    "total_assets": ("inst", ["Assets"]),
    "current_assets": ("inst", ["AssetsCurrent"]),
    "current_liabilities": ("inst", ["LiabilitiesCurrent"]),
    "shares_out": ("inst", ["dei:EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"]),
}

# Per-share / average metrics: not additive across quarters, and restated after splits,
# so we take the *latest* filing's value (split-adjusted) instead of the earliest.
PER_SHARE = {"eps_diluted"}
AVERAGE = {"shares_diluted"}

_UNIT_PREF = {
    "eps_diluted": ["USD/shares"],
    "shares_diluted": ["shares"],
    "shares_out": ["shares"],
}


@dataclass
class Fact:
    period_type: str      # Q | FY | TTM
    period_end: date
    metric: str
    value: float
    filed: date | None


def _throttle() -> None:
    global _last_request
    gap = 1.0 / max(settings.sec_requests_per_second, 0.5)
    wait = _last_request + gap - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()


def load_ticker_map() -> dict[str, dict]:
    """ticker -> {cik, title} from the SEC's public map (cached 7 days)."""
    _throttle()
    data = cached_get_json("https://www.sec.gov/files/company_tickers.json", namespace="edgar",
                           key="company_tickers", ttl_hours=24 * 7, headers=_HEADERS)
    out = {}
    for row in data.values():
        out[row["ticker"].upper().replace(".", "-")] = {"cik": int(row["cik_str"]), "title": row["title"]}
    return out


def fetch_companyfacts(cik: int) -> dict:
    _throttle()
    return cached_get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json",
                           namespace="edgar", key=f"facts_{cik}", ttl_hours=24, headers=_HEADERS)


def _d(s: str | None) -> date | None:
    return datetime.strptime(s, "%Y-%m-%d").date() if s else None


def _pick_units(metric: str, units: dict) -> list[dict]:
    prefs = _UNIT_PREF.get(metric, ["USD"])
    for u in prefs:
        if u in units:
            return units[u]
    return []


def _collect(facts: dict, metric: str) -> tuple[list[dict], str | None]:
    """All facts across the candidate tags, each annotated with its tag priority.
    Companies switch tags over time (e.g. Revenues -> RevenueFromContractWithCustomer...),
    so we merge tags and let the per-period dedupe prefer the higher-priority tag."""
    kind, tags = TAGS[metric]
    rows_all: list[dict] = []
    first_tag = None
    for prio, tag in enumerate(tags):
        ns, name = tag.split(":") if ":" in tag else ("us-gaap", tag)
        node = facts.get("facts", {}).get(ns, {}).get(name)
        if not node:
            continue
        rows = _pick_units(metric, node.get("units", {}))
        rows = [dict(r, _prio=prio) for r in rows
                if r.get("form") in ("10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F")]
        if rows and first_tag is None:
            first_tag = tag
        rows_all.extend(rows)
    return rows_all, first_tag


def _dedupe_earliest(rows: list[dict], key_fn, latest: bool = False) -> dict:
    """One value per period key: prefer the higher-priority tag, then the
    earliest filing (what the market knew first = point-in-time correctness),
    or the latest filing when `latest` (split-adjusted per-share data)."""
    out: dict = {}
    for r in rows:
        k = key_fn(r)
        if k is None:
            continue
        filed = _d(r.get("filed"))
        f_rank = -(filed.toordinal()) if (latest and filed) else (filed or date.max)
        rank = (r.get("_prio", 0), f_rank)
        if k not in out or rank < out[k]["rank"]:
            out[k] = {"val": float(r["val"]), "filed": filed, "rank": rank}
    return out


def _quarterize(rows: list[dict], average: bool = False, latest: bool = False) -> tuple[dict, dict]:
    """Return ({quarter_end: {val, filed}}, {fy_end: {...}}) of single-quarter values.
    Flows (revenue, cash) are additive: Q4 = FY - (Q1+Q2+Q3).
    Averages (share counts) are not: Q4 = 4*FY - (Q1+Q2+Q3)."""
    mult = 1.0
    by_span = _dedupe_earliest(rows, lambda r: (_d(r.get("start")), _d(r.get("end"))) if r.get("start") else None, latest=latest)
    q: dict[date, dict] = {}
    half: dict[date, dict] = {}
    nine: dict[date, dict] = {}
    fy: dict[date, dict] = {}
    for (s, e), v in by_span.items():
        days = (e - s).days
        # 12/13/16-week fiscal quarters (PepsiCo, Costco) and 52/53-week years
        if 70 <= days <= 125:
            q[e] = v
        elif 160 <= days <= 200:
            half[e] = v
        elif 240 <= days <= 300:
            nine[e] = v
        elif 340 <= days <= 380:
            fy[e] = v

    def prior_quarters(end: date, n: int) -> list[date]:
        """n quarter-ends preceding `end`, must be ~91 days apart."""
        outq = []
        cur = end
        for _ in range(n):
            cands = [d for d in q if 70 <= (cur - d).days <= 125]
            if not cands:
                return []
            cur = max(cands)
            outq.append(cur)
        return outq

    # Recover Q2 from 6M - Q1, Q3 from 9M - 6M (or 9M - Q1 - Q2)
    h_m, n_m, y_m = (2.0, 3.0, 4.0) if average else (1.0, 1.0, 1.0)
    for e, v in half.items():
        if e not in q:
            pq = prior_quarters(e, 1)
            if pq:
                q[e] = {"val": h_m * v["val"] - q[pq[0]]["val"], "filed": v["filed"]}
    for e, v in nine.items():
        if e not in q:
            h = [d for d in half if 70 <= (e - d).days <= 125]
            if h:
                q[e] = {"val": n_m * v["val"] - h_m * half[max(h)]["val"], "filed": v["filed"]}
            else:
                pq = prior_quarters(e, 2)
                if len(pq) == 2:
                    q[e] = {"val": n_m * v["val"] - sum(q[d]["val"] for d in pq), "filed": v["filed"]}
    # Q4 = FY - Q1..Q3  (or 4*FY - Q1..Q3 for averages)
    for e, v in fy.items():
        if e not in q:
            pq = prior_quarters(e, 3)
            if len(pq) == 3:
                q[e] = {"val": y_m * v["val"] - sum(q[d]["val"] for d in pq), "filed": v["filed"]}
    return q, fy


def _sum_share_classes(rows: list[dict]) -> list[dict]:
    """dei:EntityCommonStockSharesOutstanding is reported once per share class with the
    same end/filed; the economic share count is their sum."""
    agg: dict = {}
    for r in rows:
        k = (r.get("end"), r.get("filed"), r.get("_prio", 0))
        if k in agg:
            agg[k] = dict(agg[k], val=agg[k]["val"] + float(r["val"]))
        else:
            agg[k] = dict(r, val=float(r["val"]))
    return list(agg.values())


def extract_financials(facts: dict) -> list[Fact]:
    out: list[Fact] = []
    for metric, (kind, _tags) in TAGS.items():
        rows, _tag = _collect(facts, metric)
        if not rows:
            continue
        if kind == "inst":
            if metric == "shares_out":
                rows = _sum_share_classes(rows)
            by_end = _dedupe_earliest(rows, lambda r: _d(r.get("end")) if not r.get("start") or r.get("start") == r.get("end") else None,
                                      latest=(metric == "shares_out"))
            for e, v in by_end.items():
                out.append(Fact("Q", e, metric, v["val"], v["filed"]))
            continue
        average, latest = metric in AVERAGE, metric in (PER_SHARE | AVERAGE)
        q, fy = _quarterize(rows, average=average, latest=latest)
        for e, v in q.items():
            out.append(Fact("Q", e, metric, v["val"], v["filed"]))
        for e, v in fy.items():
            out.append(Fact("FY", e, metric, v["val"], v["filed"]))
        # TTM = rolling 4 consecutive quarters
        ends = sorted(q)
        for i in range(3, len(ends)):
            window = ends[i - 3:i + 1]
            gaps = [(window[j + 1] - window[j]).days for j in range(3)]
            if all(70 <= g <= 125 for g in gaps):
                total = sum(q[d]["val"] for d in window)
                out.append(Fact("TTM", ends[i], metric, total / 4.0 if average else total,
                                max((q[d]["filed"] for d in window if q[d]["filed"]), default=None)))
    return out


def company_meta(facts: dict) -> dict:
    return {"cik": facts.get("cik"), "name": facts.get("entityName")}
