from __future__ import annotations

from typing import Optional

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """All configuration is optional. With no keys at all the system still runs on
    SEC EDGAR (no key), FRED's public CSV export (no key) and Yahoo's chart endpoint."""

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Storage. SQLite by default; point at Postgres/Supabase for production, e.g.
    # postgresql+psycopg://user:pass@host:5432/dbname
    database_url: str = f"sqlite:///{BACKEND_DIR / 'data' / 'brain.db'}"
    cache_dir: Path = BACKEND_DIR / "data" / "cache"

    # Data sources
    fred_api_key: Optional[str] = None
    sec_user_agent: str = "InvestmentBrain research contact@example.com"  # SEC requires "Name email"

    # LLM enrichment (optional). Everything works deterministically without it.
    llm_provider: str = "auto"  # auto | openai | anthropic | none
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-4o-2024-08-06"
    anthropic_api_key: Optional[str] = None
    anthropic_model: str = "claude-opus-5"

    # Pipeline knobs
    universe_limit: Optional[int] = None      # cap number of companies (fast dev runs)
    price_range: str = "5y"                # Yahoo range for price history
    sec_requests_per_second: float = 5.0
    http_timeout: float = 30.0

    # Frontend origin for CORS
    portfolio_value: float = 100_000.0        # notional for share counts
    llm_top_n: int = 15                       # theses enriched beyond the portfolio holdings
    youtube_api_key: Optional[str] = None     # optional: YouTube Data API v3 key for video-velocity attention
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"


settings = Settings()
settings.cache_dir.mkdir(parents=True, exist_ok=True)
