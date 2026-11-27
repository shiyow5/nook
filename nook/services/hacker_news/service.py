import inspect
import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any

import requests
from bs4 import BeautifulSoup

from nook.services.collector_storage import CollectorStorage
from nook.services.llm_client import create_client
from nook.services.storage import build_storage_backend
from nook.services.thumbnail import image_from_soup, thumbnail_markdown

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
}
# これより短い本文は「読めた」とみなさず、コメントからの要約に切り替える
_MIN_ARTICLE_CHARS = 200
_MAX_COMMENTS = 8
_JAVASCRIPT_WALL = re.compile(
    r"enable javascript|javascript is (disabled|required)|just a moment|checking your browser",
    re.IGNORECASE,
)
_NOISE_TAGS = [
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "noscript",
]
_TEXT_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "blockquote"]
_DISCUSSION_URL = "https://news.ycombinator.com/item?id={story_id}"


def extract_article_text(html: str) -> str:
    """記事ページから本文らしいテキストを取り出す。入れ子の段落も読む。"""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(_NOISE_TAGS):
        tag.decompose()
    container = soup.find("article") or soup.find("main") or soup.body or soup
    parts = [
        node.get_text(" ", strip=True)
        for node in container.find_all(_TEXT_TAGS)
        if node.get_text(strip=True)
    ]
    text = "\n".join(parts) if parts else container.get_text("\n", strip=True)
    if len(text) < _MIN_ARTICLE_CHARS:
        meta = soup.find("meta", attrs={"property": "og:description"}) or soup.find(
            "meta", attrs={"name": "description"}
        )
        description = (meta.get("content") or "").strip() if meta else ""
        if description and description not in text:
            text = f"{text}\n{description}".strip()
    return text


_MARKDOWN_FORMAT = """
# {title}

**Score**: {score}

{url_or_text}
"""


class Config:
    hacker_news_top_stories_url = (
        "https://hacker-news.firebaseio.com/v0/topstories.json"
    )
    hacker_news_item_url = "https://hacker-news.firebaseio.com/v0/item/{story_id}.json"
    hacker_news_num_top_stories = 30
    summary_index_s3_key_format = "hacker_news/{date}.md"
    threshold_days = 1


@dataclass
class Story:
    """
    Hacker News のストーリーを表すデータクラス。

    Attributes
    ----------
    title : str
        ストーリーのタイトル。
    score : int
        ストーリーのスコア。
    url : str | None, optional
        ストーリーのURL。テキストベースの投稿の場合は None。
    text : str | None, optional
        ストーリーの本文または要約。URLベースの投稿の場合は本文の要約、
        テキストベースの投稿の場合は元のテキストまたはその要約。
    """

    title: str
    score: int
    url: str | None = None
    text: str | None = None
    story_id: int | None = None
    # リンク先の og:image(#42)
    image: str | None = None


class HackerNewsRetriever:
    """
    Hacker News からトップストーリーを取得し、必要に応じて要約してS3に保存するクラス。
    """

    def __init__(self):
        """
        HackerNewsRetriever の初期化。

        LLM クライアント、storage backend を設定します。
        """
        self._client = create_client()
        self._storage = CollectorStorage(
            service_name="hacker_news",
            backend=build_storage_backend(os.environ),
        )
        # 本文を取ったページの og:image。URL ごとに覚え、Story を作るときに添える(#42)
        self._page_images: dict[str, str] = {}

    def __call__(self) -> None:
        """
        Hacker News のトップストーリーを取得し、処理してS3に保存するメイン処理。
        """
        stories = self._get_top_stories()
        if not stories:
            print("No suitable stories found on Hacker News.")
            return
        # スコアで降順ソート
        stories.sort(key=lambda s: s.score, reverse=True)
        styled_attachments = [self._stylize_story(story) for story in stories]
        self._store_summaries(styled_attachments)

    def _get_top_stories(self) -> list[Story]:
        """
        Hacker News のトップストーリーを取得し、フィルタリングして返す。

        スコアが20未満のストーリーは除外します。
        テキストを持つストーリーはそれを要約（長すぎる/短すぎる場合はクレンジングのみ）。
        URLのみを持つストーリーはその先の記事を要約します。

        Returns
        -------
        list[Story]
            処理されたストーリーのリスト。
        """
        top_story_ids = self._get_top_storie_ids()[: Config.hacker_news_num_top_stories]

        stories: list[Story] = []
        for story_id in top_story_ids:
            story_data = self._get_story(story_id)
            # story_dataがNoneの場合や"score"がない場合はスキップ
            if not story_data or "score" not in story_data:
                print(f"Skipping story {story_id}: Invalid data")
                continue

            if story_data["score"] < 20:
                continue

            title = story_data.get("title", "No Title")
            score = story_data["score"]
            url = story_data.get("url")
            hn_text = story_data.get("text")
            summary = None

            if hn_text:
                # HN自体にテキストがある場合
                cleaned_text = self._cleanse_text(hn_text)
                if (
                    100 < len(cleaned_text) < 10000
                ):  # 長すぎる/短すぎるテキストは要約しない
                    print(f"Summarizing HN text for story {story_id}: {title[:50]}...")
                    summary = self._summarize_content(title, cleaned_text)
                else:
                    summary = cleaned_text  # 要約せず、クレンジングしたテキストを使用
            elif url:
                # URLのみの場合、リンク先の記事を要約
                print(f"Retrieving and summarizing URL for story {story_id}: {url}")
                summary = self._summarize_story_url(
                    url, title, story_data.get("kids") or []
                )
                time.sleep(2)  # LLM API のレート制限対策

            # summaryがNoneのままの場合（テキストもURLもなく要約できなかった、またはエラー発生）はスキップしない
            # textフィールドには要約結果 or クレンジングされたHNテキスト or Noneが入る
            stories.append(
                Story(
                    title=title,
                    score=score,
                    url=url,
                    text=summary,  # HNテキストがあった場合はその要約orクレンジング結果、URLの場合は記事の要約
                    story_id=story_id,
                    image=self._page_images.get(url) if url else None,
                )
            )
            # 処理の間に短い待機を入れる（API制限回避）
            time.sleep(0.5)

        return stories

    def _fetch_article_text(self, url: str) -> tuple[str, str | None]:
        """リンク先の本文を取る。読めなかったときは (途中まで取れた本文, 日本語の理由) を返す。"""
        try:
            response = requests.get(url, headers=_BROWSER_HEADERS, timeout=15)
            response.raise_for_status()
        except requests.exceptions.HTTPError as error:
            print(f"Error retrieving URL {url}: {error}")
            status = getattr(getattr(error, "response", None), "status_code", None)
            return "", f"アクセスを拒否されました({status})" if status else "取得エラー"
        except requests.exceptions.RequestException as error:
            print(f"Error retrieving URL {url}: {error}")
            return "", "接続できませんでした"
        content_type = response.headers.get("content-type", "").lower()
        if "html" not in content_type:
            return "", f"HTML ではないページ({content_type or '種類不明'})"
        image = image_from_soup(
            BeautifulSoup(response.text, "html.parser"),
            getattr(response, "url", None) or url,
        )
        if image:
            self._page_images[url] = image
        text = self._cleanse_text(extract_article_text(response.text))
        if _JAVASCRIPT_WALL.search(text[:2000]) and len(text) < 2000:
            return "", "JavaScript が必要なページ"
        if len(text) < _MIN_ARTICLE_CHARS:
            return text, "本文がほとんどないページ"
        return text, None

    def _fetch_comment_texts(self, kids: list[int]) -> list[str]:
        comments: list[str] = []
        for kid in kids[:_MAX_COMMENTS]:
            item = self._get_story(kid)
            if not item or item.get("deleted") or item.get("dead"):
                continue
            text = self._cleanse_text(item.get("text"))
            if text:
                comments.append(text)
        return comments

    def _summarize_story_url(self, url: str, title: str, kids: list[int]) -> str:
        """本文を要約する。読めなければ Hacker News のコメントから議論をまとめる。"""
        text, reason = self._fetch_article_text(url)
        if reason is None:
            print(f"Summarizing content from URL: {url}")
            return self._summarize_content(title, text[:20000])
        comments = self._fetch_comment_texts(kids)
        if comments:
            material = "\n\n".join(
                part
                for part in [
                    text,
                    "Hacker News のコメント:\n" + "\n---\n".join(comments),
                ]
                if part
            )
            summary = self._summarize_content(title, material[:20000])
            return (
                f"(元記事の本文を読めなかったため({reason})、"
                f"Hacker News のコメントから議論をまとめています)\n\n{summary}"
            )
        return f"元記事の本文を読めませんでした({reason})。元記事を開いて確認してください。"

    def _summarize_content(self, title: str, text: str) -> str:
        """
        与えられたタイトルとテキストを LLM で要約する。

        Parameters
        ----------
        title : str
            記事のタイトル。
        text : str
            要約対象のテキスト本文。

        Returns
        -------
        str
            要約結果のテキスト。エラー時はエラーメッセージ。
        """
        try:
            return self._client.generate_content(
                contents=self._contents_format.format(title=title, text=text),
                system_instruction=self._system_instruction_for_articles,  # 記事要約用のプロンプトを使用
            )
        except Exception as e:
            print(f"Error during summarization for title '{title[:50]}...': {e}")
            return "要約の作成に失敗しました。元記事を開いて確認してください。"

    def _get_top_storie_ids(self) -> list[int]:
        """Hacker News のトップストーリーIDリストを取得する。"""
        try:
            response = requests.get(
                Config.hacker_news_top_stories_url,
                headers={"Content-Type": "application/json"},
                timeout=10,
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching top story IDs: {e}")
            return []

    def _get_story(self, story_id: int) -> dict[str, Any] | None:
        """指定されたIDのストーリー詳細を取得する。"""
        try:
            response = requests.get(
                Config.hacker_news_item_url.format(story_id=story_id),
                headers={"Content-Type": "application/json"},
                timeout=10,
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching story {story_id}: {e}")
            return None
        except json.JSONDecodeError as e:
            print(f"Error decoding JSON for story {story_id}: {e}")
            return None

    def _cleanse_text(self, text: str | None) -> str:
        """
        HTMLタグを除去し、テキストをクレンジングする。

        Parameters
        ----------
        text : str | None
            クレンジング対象のテキスト。Noneの場合は空文字列を返す。

        Returns
        -------
        str
            クレンジングされたテキスト。
        """
        # Added check for None or empty string
        if not text:
            return ""
        # `get_text` は基本的なタグ除去を行う
        soup = BeautifulSoup(text, "html.parser")
        # separatorに改行を指定し、strip=Trueで前後の空白を除去
        return soup.get_text(separator="\n", strip=True)

    def _store_summaries(self, summaries: list[str]) -> None:
        """
        要約リストを結合し、MarkdownファイルとしてS3に保存する。

        Parameters
        ----------
        summaries : list[str]
            Markdown形式の要約文字列のリスト。
        """
        if not self._storage.write_daily_markdown(summaries, separator="\n---\n"):
            print("No summaries to store.")
            return
        print("Successfully stored Hacker News summaries.")

    def _stylize_story(self, story: Story) -> str:
        """
        StoryオブジェクトをMarkdown形式の文字列に整形する。

        Parameters
        ----------
        story : Story
            整形対象のStoryオブジェクト。

        Returns
        -------
        str
            Markdown形式の文字列。
        """
        # textがNoneの場合や空の場合のフォールバックを追加
        summary_text = (
            story.text
            if story.text and story.text.strip()
            else "Summary not available."
        )

        # URLがある場合はリンクを表示、ない場合は要約テキストを直接表示
        if story.url:
            links = f"[View Link]({story.url})"
            if story.story_id is not None:
                discussion = _DISCUSSION_URL.format(story_id=story.story_id)
                links = f"{links} · [Hacker News のコメント]({discussion})"
            thumbnail = thumbnail_markdown(story.image)
            url_or_text = "\n\n".join(
                part for part in [links, thumbnail, summary_text] if part
            )
        else:
            # URLがなく、HNのテキストを要約した場合 or そのまま表示した場合
            url_or_text = summary_text

        return _MARKDOWN_FORMAT.format(
            title=story.title,
            score=story.score,
            url_or_text=url_or_text,
        )

    @property
    def _system_instruction_for_articles(self) -> str:
        return inspect.cleandoc(
            """
            あなたは、与えられた記事のタイトルと本文を読んで日本語で要約を作成するアシスタントです。
            本文はHTMLから抽出されたもので、不完全な場合や不要な情報が含まれる場合があります。
            記事の主要なポイントを捉え、簡潔かつ分かりやすい要約を作成してください。
            要約以外の余計な文章は含めないでください。
            """
        )

    @property
    def _contents_format(self) -> str:
        return inspect.cleandoc(
            """
            タイトル
            ```
            {title}
            ```

            本文
            ```
            {text}
            ```
            """
        )
