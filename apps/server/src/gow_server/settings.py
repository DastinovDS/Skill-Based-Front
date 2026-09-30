"""Server settings, read from environment variables with the ``GOW_`` prefix."""

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All server configuration. Example: ``GOW_PORT=9000 uv run gow-server``."""

    model_config = SettingsConfigDict(env_prefix="GOW_", extra="forbid", frozen=True)

    env: Literal["dev", "e2e", "prod"] = "dev"
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    forwarded_allow_ips: str = "127.0.0.1"
    """Proxies trusted for X-Forwarded-* headers (uvicorn ``--forwarded-allow-ips``): Caddy."""
    maps_dir: Path = Path("maps")
    """Directory with the map pool: ``<id>.json`` and optional background ``<id>.bg.png``."""
    database_url: str = "sqlite:///data/gow.db"
    """SQLite only; a relative path is relative to the working directory."""
