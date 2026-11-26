from datetime import date, timedelta
from typing import Any

import feedparser

from nook.services.tech_news.service import TechNews

# arXiv RSS の announce_type。replace / replace-cross は既存論文の改訂なので扱わない
_NEW_ANNOUNCE_TYPES = frozenset({"new", "cross"})
# paper_summarizer(Hugging Face Daily Papers)の既読 ID を何日分さかのぼるか
_HUGGING_FACE_LOOKBACK_DAYS = 7


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
