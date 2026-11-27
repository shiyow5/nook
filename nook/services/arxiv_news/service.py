import re
from datetime import date, timedelta
from typing import Any

import feedparser
import requests
from bs4 import BeautifulSoup

from nook.services.arxiv_html import ARXIV_HTML_URL, extract_body_text
from nook.services.tech_news.service import Article, TechNews
from nook.services.thumbnail import first_figure_image

# arXiv RSS の announce_type。replace / replace-cross は既存論文の改訂なので扱わない
_NEW_ANNOUNCE_TYPES = frozenset({"new", "cross"})
# paper_summarizer(Hugging Face Daily Papers)の既読 ID を何日分さかのぼるか
_HUGGING_FACE_LOOKBACK_DAYS = 7
# RSS の説明文は「arXiv:<id> Announce Type: new\nAbstract: 本文」の形
_ABSTRACT_PREFIX = re.compile(r"^.*?Abstract:\s*", re.DOTALL)
_HTML_TIMEOUT_SECONDS = 30
_USER_AGENT = "Mozilla/5.0 (compatible; nook-collector)"


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
        """RSS のアブストラクトと、HTML 版の本文をつないで要約に渡す。

        abs ページはアブストラクトが p 要素に無く汎用の抽出では拾えないため使わない。
        HTML 版が無い論文はアブストラクトだけで要約する。
        """
        url = entry.get("link", "").split("?")[0]
        abstract = _abstract_text(entry)
        if not abstract:
            print(f"Abstract not found in RSS for: {url}")
            return None
        title = entry.get("title", "Unknown Title")
        html, html_url = _fetch_html(url)
        return Article(
            feed_name=feed_name,
            title=title,
            url=url,
            text=_join_sections(
                title, abstract, extract_body_text(html) if html else ""
            ),
            soup=BeautifulSoup("", "html.parser"),
            # 論文の最初の図をサムネイルにする(#42)
            image=first_figure_image(html, html_url) if html else None,
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


def _fetch_html(abs_url: str) -> tuple[str, str]:
    """HTML 版を取る。(HTML, 画像の相対パスを解決する基準の URL) を返し、無ければ HTML は空。"""
    arxiv_id = abs_url.rstrip("/").split("/")[-1]
    html_url = ARXIV_HTML_URL.format(arxiv_id=arxiv_id)
    try:
        response = requests.get(
            html_url,
            headers={"User-Agent": _USER_AGENT},
            timeout=_HTML_TIMEOUT_SECONDS,
        )
    except requests.exceptions.RequestException as error:
        print(f"Failed to fetch arXiv HTML for {arxiv_id}: {error}")
        return "", html_url
    if response.status_code != 200:
        print(f"arXiv HTML not available for {arxiv_id}: {response.status_code}")
        return "", html_url
    response.encoding = "utf-8"
    return response.text, getattr(response, "url", None) or html_url


def _join_sections(title: str, abstract: str, body: str) -> str:
    # 要約側は先頭から上限字数で切るので、アブストラクトを本文より前に置く
    text = f"{title}\n\nAbstract: {abstract}"
    return f"{text}\n\n本文:\n{body}" if body else text
