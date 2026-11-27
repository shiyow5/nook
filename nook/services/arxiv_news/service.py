import re
from datetime import date, timedelta
from typing import Any

import feedparser
from bs4 import BeautifulSoup

from nook.services.tech_news.service import Article, TechNews

# arXiv RSS の announce_type。replace / replace-cross は既存論文の改訂なので扱わない
_NEW_ANNOUNCE_TYPES = frozenset({"new", "cross"})
# paper_summarizer(Hugging Face Daily Papers)の既読 ID を何日分さかのぼるか
_HUGGING_FACE_LOOKBACK_DAYS = 7
# RSS の説明文は「arXiv:<id> Announce Type: new\nAbstract: 本文」の形
_ABSTRACT_PREFIX = re.compile(r"^.*?Abstract:\s*", re.DOTALL)


class ArxivNews(TechNews):
    """arXiv の新着 RSS をキーワードで絞り、tech_news と同じ手順で要約する。"""

    SERVICE_NAME = "arxiv_news"

    def _filter_entries(
        self,
        feed_parser: feedparser.FeedParserDict,
        keywords: list[str] | None,
    ) -> list[dict[str, Any]]:
        entries = super()._filter_entries(feed_parser, keywords)
        return [
            entry
            for entry in entries
            if entry.get("arxiv_announce_type", "new") in _NEW_ANNOUNCE_TYPES
        ]

    def _retrieve_article(
        self,
        entry: dict[str, Any],
        feed_name: str,
    ) -> Article | None:
        """論文ページはアブストラクトが p 要素に無く拾えないので、RSS のアブストラクトを使う。"""
        url = entry.get("link", "").split("?")[0]
        abstract = _abstract_text(entry)
        if not abstract:
            print(f"Abstract not found in RSS for: {url}")
            return None
        title = entry.get("title", "Unknown Title")
        return Article(
            feed_name=feed_name,
            title=title,
            url=url,
            text=f"{title}\n\n{abstract}",
            soup=BeautifulSoup("", "html.parser"),
        )

    def _initially_processed_urls(self) -> set[str]:
        """Hugging Face Daily Papers で直近に要約した論文は arXiv タブでは要約しない。"""
        processed: set[str] = set()
        for days_ago in range(_HUGGING_FACE_LOOKBACK_DAYS + 1):
            day = date.today() - timedelta(days=days_ago)
            content = self._storage.backend.read_state(
                "paper_summarizer", f"arxiv_ids-{day.isoformat()}.txt"
            )
            if content is None:
                continue
            processed.update(
                f"https://arxiv.org/abs/{arxiv_id.strip()}"
                for arxiv_id in content.splitlines()
                if arxiv_id.strip()
            )
        return processed


def _abstract_text(entry: dict[str, Any]) -> str:
    raw = entry.get("summary_detail", {}).get("value") or entry.get("summary", "")
    text = BeautifulSoup(raw, "html.parser").get_text()
    if "Abstract:" not in text:
        return ""
    return " ".join(_ABSTRACT_PREFIX.sub("", text, count=1).split())
