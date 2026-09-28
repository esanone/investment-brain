"""EDGAR events: Form 4 insider transactions and 8-K material events, key-free.

Submissions API (one call per company, cached 20h) lists recent filings with form type, items and the
primary document. Form 4 XML is fetched once per accession and parsed for open-market purchases/sales.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from typing import Optional

from ..config import settings
from .edgar import _HEADERS, _throttle
from .http import cached_get, cached_get_json

ITEM_LABELS = {
    "1.01": "Material agreement", "1.02": "Termination of agreement", "1.03": "Bankruptcy", "1.05": "Cybersecurity incident",
    "2.01": "Acquisition or disposition", "2.02": "Results of operations", "2.03": "New debt obligation", "2.04": "Debt acceleration",
    "2.05": "Restructuring / exit costs", "2.06": "Material impairment", "3.01": "Delisting notice", "3.02": "Unregistered equity sale",
    "4.01": "Auditor change", "4.02": "Non-reliance on prior financials (restatement)", "5.01": "Change in control",
    "5.02": "Officer / director change", "5.03": "Bylaw or fiscal-year change", "5.07": "Shareholder vote", "7.01": "Reg FD disclosure",
    "8.01": "Other events", "9.01": "Exhibits",
}
SEVERITY = {"4.02": "high", "1.03": "high", "2.04": "high", "3.01": "high", "5.02": "medium", "2.06": "medium", "2.05": "medium",
            "1.05": "medium", "4.01": "medium", "5.01": "medium", "2.02": "info", "1.01": "info", "2.01": "info", "2.03": "info",
            "7.01": "low", "8.01": "low", "9.01": "none", "5.07": "none", "5.03": "none", "3.02": "low", "1.02": "low"}


def submissions(cik: int) -> dict:
    _throttle()
    return cached_get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", namespace="edgar", key=f"sub_{cik}", ttl_hours=20, headers=_HEADERS)


def recent_filings(cik: int, forms: tuple[str, ...], since: date) -> list[dict]:
    sub = submissions(cik)
    r = sub.get("filings", {}).get("recent", {})
    out = []
    for acc, fdate, form, doc, items, rdate in zip(r.get("accessionNumber", []), r.get("filingDate", []), r.get("form", []),
                                                   r.get("primaryDocument", []), r.get("items", []), r.get("reportDate", [])):
        if form in forms and fdate >= since.isoformat():
            out.append({"accession": acc, "filed": fdate, "form": form, "primary_doc": doc, "items": items, "report_date": rdate,
                        "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}"})
    return out


def _txt(el: Optional[ET.Element], path: str) -> str:
    if el is None:
        return ""
    n = el.find(path)
    return (n.text or "").strip() if n is not None and n.text else ""


def form4_transactions(cik: int, filing: dict) -> list[dict]:
    """Non-derivative transactions of one Form 4 (open-market buys 'P' and sales 'S' matter most)."""
    raw = filing["primary_doc"].split("/")[-1]
    url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{filing['accession'].replace('-', '')}/{raw}"
    _throttle()
    try:
        xml_text = cached_get(url, namespace="form4", key=filing["accession"], ttl_hours=24 * 365, headers=_HEADERS, suffix=".xml")
        root = ET.fromstring(xml_text)
    except Exception as e:
        print(f"[events] form4 {filing['accession']}: {e}")
        return []
    owners = []
    for ro in root.findall("reportingOwner"):
        rel = ro.find("reportingOwnerRelationship")
        owners.append({"name": _txt(ro, "reportingOwnerId/rptOwnerName"), "cik": _txt(ro, "reportingOwnerId/rptOwnerCik"),
                       "is_director": _txt(rel, "isDirector") in ("1", "true"), "is_officer": _txt(rel, "isOfficer") in ("1", "true"),
                       "is_ten_pct": _txt(rel, "isTenPercentOwner") in ("1", "true"), "title": _txt(rel, "officerTitle")})
    owner = owners[0] if owners else {"name": "?", "cik": "", "is_director": False, "is_officer": False, "is_ten_pct": False, "title": ""}
    aff = _txt(root, "aff10b5One") in ("1", "true")
    out = []
    for tx in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        code = _txt(tx, "transactionCoding/transactionCode")
        shares = _txt(tx, "transactionAmounts/transactionShares/value")
        price = _txt(tx, "transactionAmounts/transactionPricePerShare/value")
        ad = _txt(tx, "transactionAmounts/transactionAcquiredDisposedCode/value")
        tdate = _txt(tx, "transactionDate/value")
        try:
            sh, px = float(shares or 0), float(price or 0)
        except ValueError:
            sh, px = 0.0, 0.0
        post = _txt(tx, "postTransactionAmounts/sharesOwnedFollowingTransaction/value")
        out.append({"accession": filing["accession"], "filed": filing["filed"], "date": tdate or filing["filed"], "code": code,
                    "acquired": ad == "A", "shares": sh, "price": px, "value": sh * px,
                    "owner": owner["name"], "owner_cik": owner["cik"], "title": owner["title"], "is_director": owner["is_director"],
                    "is_officer": owner["is_officer"], "is_ten_pct": owner["is_ten_pct"], "rule_10b5_1": aff,
                    "shares_after": float(post) if post.replace(".", "", 1).isdigit() else None, "url": filing["url"]})
    return out
