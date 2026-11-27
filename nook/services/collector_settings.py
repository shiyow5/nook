"""画面の設定画面(#7)で保存した収集の設定を、collector 側で読む。

設定は R2 の `_state/_settings/settings.json` に置く(Worker の settings.ts が書く)。
collector は起動時に、TOML から作った既定値を `_state/_settings/defaults.json` に書き出し、
設定画面はそれを初期値として表示する。どちらも無ければ従来どおり `configs/*.toml` だけで動く。
"""

import json
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, ValidationError, field_validator

from nook.services.storage import StorageBackend

SETTINGS_SERVICE = "_settings"
SETTINGS_KEY = "settings.json"
DEFAULTS_KEY = "defaults.json"
# 設定画面でフィードとキーワードを編集できる collector(TechNews 系)
RSS_SERVICES = ("tech_news", "jp_tech_news", "arxiv_news")

SettingsMode = Literal["apply", "publish"]


class FeedSetting(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    feed_name_display: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=1, max_length=500)
    keywords: list[str] | None = Field(default=None, max_length=50)

    @field_validator("url")
    @classmethod
    def _http_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("feed url must be http(s)")
        return value

    @field_validator("keywords")
    @classmethod
    def _non_empty_keywords(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and any(
            not keyword.strip() or len(keyword) > 60 for keyword in value
        ):
            raise ValueError("keywords must be 1-60 characters")
        return value or None


class RssSettings(BaseModel):
    max_entries_per_feed: int = Field(ge=1, le=50)
    feeds: list[FeedSetting] = Field(min_length=1, max_length=50)


class CollectorToggle(BaseModel):
    enabled: bool


class CollectorSettings(BaseModel):
    version: Literal[1] = 1
    collectors: dict[str, CollectorToggle] = Field(default_factory=dict)
    rss: dict[str, RssSettings] = Field(default_factory=dict)
    updated_at: str | None = None

    def is_enabled(self, name: str) -> bool:
        toggle = self.collectors.get(name)
        return True if toggle is None else toggle.enabled


def load_settings(backend: StorageBackend) -> CollectorSettings | None:
    """保存された設定を読む。壊れていたら警告を出して無視し、TOML の既定値で収集を続ける。"""
    raw = backend.read_state(SETTINGS_SERVICE, SETTINGS_KEY)
    if raw is None:
        return None
    try:
        return CollectorSettings.model_validate_json(raw)
    except ValidationError as error:
        print(f"Ignoring invalid collector settings: {error}")
        return None


def build_defaults(collectors: Sequence[str]) -> dict[str, Any]:
    from nook.services.tech_news.service import Config

    return {
        "version": 1,
        "collectors": list(collectors),
        "rss": {
            service: {
                "max_entries_per_feed": Config.max_entries_per_feed,
                "feeds": [feed.model_dump() for feed in Config.load_feeds(service)],
            }
            for service in RSS_SERVICES
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def apply_collector_settings(
    names: Sequence[str],
    backend: StorageBackend,
    *,
    mode: SettingsMode,
    scheduled: Sequence[str],
) -> list[str]:
    """既定値を書き出し、設定の有効期限を延ばし、apply なら無効にした collector を外す。"""
    backend.write_state(
        SETTINGS_SERVICE,
        DEFAULTS_KEY,
        json.dumps(build_defaults(scheduled), ensure_ascii=False),
    )
    raw = backend.read_state(SETTINGS_SERVICE, SETTINGS_KEY)
    if raw is not None:
        # R2 の自動削除(作成から 90 日)で設定が消えないよう、毎回書き直して日付を新しくする
        backend.write_state(SETTINGS_SERVICE, SETTINGS_KEY, raw)
    settings = load_settings(backend)
    if mode == "publish" or settings is None:
        return list(names)
    skipped = [name for name in names if not settings.is_enabled(name)]
    if skipped:
        print(
            json.dumps(
                {"event": "collectors_disabled_by_settings", "collectors": skipped}
            )
        )
    return [name for name in names if settings.is_enabled(name)]
