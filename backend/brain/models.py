from __future__ import annotations

from typing import Optional

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Company(Base):
    __tablename__ = "companies"
    ticker: Mapped[str] = mapped_column(String(12), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    cik: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sector: Mapped[str] = mapped_column(String(60))
    industry: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    size: Mapped[str] = mapped_column(String(10), default="large")  # large | mid
    source: Mapped[str] = mapped_column(String(10), default="seed")  # seed (universe.py) | custom (added via search)


class Instrument(Base):
    """ETFs / indices tracked by the capital-flow engine."""
    __tablename__ = "instruments"
    symbol: Mapped[str] = mapped_column(String(12), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    group: Mapped[str] = mapped_column(String(30))   # sector|industry|factor|size|region|bond|commodity|crypto|benchmark
    sector: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)


class Price(Base):
    __tablename__ = "prices"
    symbol: Mapped[str] = mapped_column(String(12), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    close: Mapped[float] = mapped_column(Float)
    adj_close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float)
    open: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    high: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    low: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class MacroObservation(Base):
    __tablename__ = "macro_observations"
    series_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    value: Mapped[float] = mapped_column(Float)


class Fundamental(Base):
    """Standardised, point-in-time company financials derived from XBRL.
    period_type: Q (single quarter, derived) | FY (fiscal year) | TTM (trailing 4 quarters)."""
    __tablename__ = "fundamentals"
    ticker: Mapped[str] = mapped_column(String(12), primary_key=True)
    period_type: Mapped[str] = mapped_column(String(4), primary_key=True)
    period_end: Mapped[date] = mapped_column(Date, primary_key=True)
    metric: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[float] = mapped_column(Float)
    filed: Mapped[Optional[date]] = mapped_column(Date, nullable=True)   # when the market first knew this


class Theme(Base):
    __tablename__ = "themes"
    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    parent_id: Mapped[Optional[str]] = mapped_column(String(60), ForeignKey("themes.id"), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    human_needs: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)   # Human Future Engine hooks
    horizon_years: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    constraints: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)   # Trend -> Constraint -> Solution chain
    related_etfs: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)


class ThemeExposure(Base):
    __tablename__ = "theme_exposures"
    theme_id: Mapped[str] = mapped_column(String(60), ForeignKey("themes.id"), primary_key=True)
    ticker: Mapped[str] = mapped_column(String(12), primary_key=True)
    weight: Mapped[float] = mapped_column(Float)        # 0..1 share of the company's story tied to this theme
    order: Mapped[int] = mapped_column(Integer, default=1)  # 1 first-order, 2 second-order, 3 third-order


class Snapshot(Base):
    """Every engine run persists its output here so the API is a pure reader and
    history accumulates for later back-testing of the scores themselves."""
    __tablename__ = "snapshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(40), index=True)
    kind: Mapped[str] = mapped_column(String(20))          # regime|flows|theme|company|risk|meta
    key: Mapped[str] = mapped_column(String(60), default="")
    as_of: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    payload: Mapped[dict] = mapped_column(JSON)


Index("ix_snapshots_kind_key", Snapshot.kind, Snapshot.key)
Index("ix_fundamentals_ticker_metric", Fundamental.ticker, Fundamental.metric)


class AttentionObservation(Base):
    """Daily attention readings we collect ourselves (Stocktwits watchers, app ranks, GitHub repos, ...)."""
    __tablename__ = "attention_observations"
    source: Mapped[str] = mapped_column(String(20), primary_key=True)
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    metric: Mapped[str] = mapped_column(String(30), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    value: Mapped[float] = mapped_column(Float)
