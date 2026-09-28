"""Events Engine — the pre-open tape: insider cluster buys (Form 4), 8-K material events, earnings due today
with surprises, and pre-market gaps. Each company gets triggers that feed the brief and portfolio conviction.

Insider signal (Cohen, Malloy & Pomorski): only opportunistic open-market purchases matter. Routine 10b5-1 trades
and option exercises are ignored. A cluster buy = 2+ distinct insiders buying within 14 days, or one officer/director
buying >= $250k. Post-earnings drift (Bernard & Thomas): gap-ups on beats tend to keep drifting; gap-downs on misses too.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from ..data.edgar_events import ITEM_LABELS, SEVERITY
from .common import r

RULES = {"cluster_days": 14, "cluster_min_insiders": 2, "notable_buy_usd": 250_000, "lookback_days": 45, "gap_pct": 4.0}


def _row(x: dict) -> dict:
    return {"date": str(x["date"])[:10], "owner": x["owner"], "title": x["title"], "shares": x["shares"], "price": x["price"], "value": r(x["value"], 0), "url": x["url"]}


def insider_signals(transactions: list[dict], today: date) -> dict[str, dict]:
    """transactions: rows for the universe (last 45 days). -> {ticker: {cluster_buy, notable_buys[], buys[], sells[], net_buy_usd, ...}}"""
    by_t: dict[str, list[dict]] = {}
    for tx in transactions:
        if isinstance(tx.get("date"), str):
            tx["date"] = date.fromisoformat(tx["date"][:10])
        by_t.setdefault(tx["ticker"], []).append(tx)
    out = {}
    cutoff = today - timedelta(days=RULES["cluster_days"])
    for t, rows in by_t.items():
        buys = [x for x in rows if x["code"] == "P" and x["acquired"] and not x["rule_10b5_1"] and x["value"] > 0]
        sells = [x for x in rows if x["code"] == "S" and not x["acquired"] and not x["rule_10b5_1"] and x["value"] > 0]
        recent_buys = [x for x in buys if x["date"] >= cutoff]
        insiders = {x["owner"] for x in recent_buys}
        notable = [x for x in recent_buys if x["value"] >= RULES["notable_buy_usd"] and (x["is_officer"] or x["is_director"])]
        cluster = len(insiders) >= RULES["cluster_min_insiders"]
        net = sum(x["value"] for x in buys) - sum(x["value"] for x in sells)
        signal = "cluster_buy" if cluster else "notable_buy" if notable else "buying" if recent_buys else ("heavy_selling" if sum(x["value"] for x in sells) > 5e6 else "none")
        out[t] = {"signal": signal, "cluster_buy": cluster, "n_buyers_14d": len(insiders), "buy_usd_45d": r(sum(x["value"] for x in buys), 0),
                  "sell_usd_45d": r(sum(x["value"] for x in sells), 0), "net_usd_45d": r(net, 0),
                  "notable_buys": [_row(x) for x in sorted(notable, key=lambda z: -z["value"])[:5]],
                  "recent_buys": [_row(x) for x in sorted(recent_buys, key=lambda z: z["date"], reverse=True)[:8]],
                  "top_sells": [_row(x) for x in sorted(sells, key=lambda z: -z["value"])[:3]]}
    return out


def filing_signals(filings: list[dict], today: date, days: int = 14) -> dict[str, list[dict]]:
    cutoff = (today - timedelta(days=days)).isoformat()
    out: dict[str, list[dict]] = {}
    for f in filings:
        if f["filed"] < cutoff:
            continue
        codes = [c.strip() for c in (f["items"] or "").split(",") if c.strip()]
        sev = max((SEVERITY.get(c, "low") for c in codes), key=lambda s: ["none", "low", "info", "medium", "high"].index(s)) if codes else "low"
        out.setdefault(f["ticker"], []).append({"filed": f["filed"], "items": codes, "labels": [ITEM_LABELS.get(c, c) for c in codes],
                                                "severity": sev, "url": f["url"]})
    for t in out:
        out[t].sort(key=lambda x: x["filed"], reverse=True)
    return out


def compute(companies: dict[str, dict], transactions: list[dict], filings: list[dict], earnings: list[dict], quotes: dict[str, dict],
            holdings: set[str], today: Optional[date] = None) -> dict:
    today = today or date.today()
    ins = insider_signals(transactions, today)
    fil = filing_signals(filings, today)
    # earnings this week (Finnhub) for the universe
    week = [e for e in earnings if e.get("symbol") in companies]
    earn_today = [e for e in week if e.get("date") == today.isoformat()]
    reported = [e for e in week if e.get("epsActual") is not None and e.get("epsEstimate") not in (None, 0)]
    for e in reported:
        e["surprise_pct"] = r((e["epsActual"] - e["epsEstimate"]) / abs(e["epsEstimate"]) * 100, 1)
    # pre-market gaps
    gaps = []
    for t, q in quotes.items():
        pc, c = q.get("pc"), q.get("c")
        if pc and c:
            g = (c / pc - 1) * 100
            if abs(g) >= RULES["gap_pct"]:
                gaps.append({"ticker": t, "name": companies.get(t, {}).get("name"), "gap_pct": r(g, 1), "prev_close": pc, "last": c,
                             "in_portfolio": t in holdings, "earnings": next((x for x in reported if x["symbol"] == t), None),
                             "insider": ins.get(t, {}).get("signal"), "filings": fil.get(t, [])[:2]})
    gaps.sort(key=lambda x: -abs(x["gap_pct"]))
    # per-company triggers
    triggers: dict[str, dict] = {}
    for t in companies:
        i, f = ins.get(t), fil.get(t, [])
        flags = []
        if i and i["cluster_buy"]:
            flags.append("insider_cluster_buy")
        elif i and i["signal"] == "notable_buy":
            flags.append("insider_notable_buy")
        if any(x["severity"] == "high" for x in f):
            flags.append("8k_high_severity")
        if any("5.02" in x["items"] for x in f):
            flags.append("officer_change")
        if any("2.02" in x["items"] for x in f):
            flags.append("results_filed")
        if any(e["symbol"] == t for e in earn_today):
            flags.append("earnings_today")
        g = next((x for x in gaps if x["ticker"] == t), None)
        if g:
            flags.append("gap_up" if g["gap_pct"] > 0 else "gap_down")
        if flags:
            triggers[t] = {"flags": flags, "insider": i, "filings": f[:5], "gap": g}
    tape = []
    for t, tr in triggers.items():
        score = (3 if "insider_cluster_buy" in tr["flags"] else 2 if "insider_notable_buy" in tr["flags"] else 0) \
              + (3 if "8k_high_severity" in tr["flags"] else 0) + (1 if "officer_change" in tr["flags"] else 0) \
              + (2 if "earnings_today" in tr["flags"] else 0) + (2 if tr["gap"] else 0)
        tape.append({"ticker": t, "name": companies[t]["name"], "sector": companies[t]["sector"], "in_portfolio": t in holdings,
                     "flags": tr["flags"], "priority": score,
                     "headline": "; ".join(filter(None, [
                         f"insider cluster buy ({tr['insider']['n_buyers_14d']} insiders, ${tr['insider']['buy_usd_45d']:,.0f})" if "insider_cluster_buy" in tr["flags"] else
                         (f"insider buy ${tr['insider']['notable_buys'][0]['value']:,.0f} by {tr['insider']['notable_buys'][0]['owner']}" if "insider_notable_buy" in tr["flags"] else None),
                         "; ".join(f"8-K {x['filed']}: {', '.join(x['labels'])}" for x in tr["filings"][:2] if x["severity"] in ("high", "medium", "info")),
                         "earnings today" if "earnings_today" in tr["flags"] else None,
                         f"pre-market gap {tr['gap']['gap_pct']:+.1f}%" if tr["gap"] else None]))})
    tape.sort(key=lambda x: (-x["in_portfolio"], -x["priority"]))
    return {
        "as_of": today.isoformat(), "rules": RULES,
        "sources": {"form4": len(transactions), "8k": len(filings), "earnings_calendar": len(week), "quotes": len(quotes)},
        "tape": tape[:60], "triggers": triggers,
        "insider": {"cluster_buys": [{"ticker": t, "name": companies[t]["name"], **i} for t, i in ins.items() if i["cluster_buy"] and t in companies],
                    "notable_buys": [{"ticker": t, "name": companies[t]["name"], **i} for t, i in ins.items() if i["signal"] == "notable_buy" and t in companies],
                    "heavy_selling": sorted(({"ticker": t, "name": companies[t]["name"], "sell_usd_45d": i["sell_usd_45d"], "top_sells": i["top_sells"]}
                                             for t, i in ins.items() if t in companies and (i["sell_usd_45d"] or 0) > 5e6), key=lambda x: -x["sell_usd_45d"])[:15]},
        "filings": {"high": [{"ticker": t, "name": companies[t]["name"], **x} for t, fs in fil.items() if t in companies for x in fs if x["severity"] == "high"],
                    "medium": [{"ticker": t, "name": companies[t]["name"], **x} for t, fs in fil.items() if t in companies for x in fs if x["severity"] == "medium"],
                    "results": [{"ticker": t, "name": companies[t]["name"], **x} for t, fs in fil.items() if t in companies for x in fs if "2.02" in x["items"]][:40]},
        "earnings": {"today": earn_today, "this_week": week[:80], "reported": sorted(reported, key=lambda e: -(e.get("surprise_pct") or 0))[:40]},
        "gaps": gaps[:40],
        "method": "Insider: open-market purchases only (code P, not 10b5-1); cluster = 2+ insiders in 14 days or one officer/director >= $250k. "
                  "8-K severity from item codes (4.02 restatement, 1.03, 2.04, 3.01 high; 5.02, 2.05, 2.06, 1.05 medium). Gaps >= 4% vs previous close from pre-market quotes.",
    }
