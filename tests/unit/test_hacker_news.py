from pathlib import Path

import pytest

import nook.services.hacker_news.service as hn
from nook.services.storage import FilesystemStorageBackend

ARTICLE_HTML = """<html><head><meta property="og:description" content="Short description."></head>
<body><nav>menu</nav><article><div class="wrapper"><h1>AI made self-hosting fun again</h1>
<p>Running services at home used to mean hours of reading documentation and fixing broken configs.</p>
<p>With an assistant that writes compose files and explains errors, the author rebuilt the whole home lab in a weekend.</p>
</div></article><footer>footer</footer></body></html>"""


class FakeResponse:
    def __init__(
        self, status: int, text: str = "", content_type: str = "text/html", payload=None
    ) -> None:
        self.status_code = status
        self.text = text
        self.headers = {"content-type": content_type}
        self._payload = payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise hn.requests.exceptions.HTTPError(f"{self.status_code} Client Error")

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def generate_content(self, *, contents: str, system_instruction: str) -> str:
        self.calls.append(
            {"contents": contents, "system_instruction": system_instruction}
        )
        return "日本語の要約"


@pytest.fixture
def retriever(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    client = FakeClient()
    monkeypatch.setattr(hn, "create_client", lambda **kwargs: client)
    monkeypatch.setattr(
        hn,
        "build_storage_backend",
        lambda env: FilesystemStorageBackend(data_dir=tmp_path),
    )
    instance = hn.HackerNewsRetriever()
    instance.fake_client = client
    return instance


def test_extract_article_text_reads_nested_paragraphs() -> None:
    text = hn.extract_article_text(ARTICLE_HTML)

    assert "hours of reading documentation" in text
    assert "rebuilt the whole home lab" in text
    assert "menu" not in text


def test_fetch_sends_a_browser_user_agent(
    monkeypatch: pytest.MonkeyPatch, retriever
) -> None:
    seen: dict = {}

    def fake_get(url, **kwargs):
        seen.update(kwargs)
        return FakeResponse(200, ARTICLE_HTML)

    monkeypatch.setattr(hn.requests, "get", fake_get)

    text, reason = retriever._fetch_article_text("https://example.com/post")

    assert reason is None
    assert "Mozilla/5.0" in seen["headers"]["User-Agent"]
    assert "rebuilt the whole home lab" in text


def test_summary_passes_the_system_instruction_text(
    monkeypatch: pytest.MonkeyPatch, retriever
) -> None:
    monkeypatch.setattr(
        hn.requests, "get", lambda url, **kwargs: FakeResponse(200, ARTICLE_HTML)
    )

    summary = retriever._summarize_story_url(
        "https://example.com/post", "AI made self-hosting fun again", []
    )

    assert summary == "日本語の要約"
    instruction = retriever.fake_client.calls[0]["system_instruction"]
    assert isinstance(instruction, str) and "日本語で要約" in instruction


def test_unreadable_article_falls_back_to_hacker_news_comments(
    monkeypatch: pytest.MonkeyPatch, retriever
) -> None:
    def fake_get(url, **kwargs):
        if url.startswith("https://hacker-news.firebaseio.com/v0/item/"):
            item_id = int(url.rsplit("/", 1)[1].split(".")[0])
            return FakeResponse(
                200,
                payload={
                    "id": item_id,
                    "text": f"Comment number {item_id} with an opinion.",
                },
            )
        return FakeResponse(403)

    monkeypatch.setattr(hn.requests, "get", fake_get)

    summary = retriever._summarize_story_url(
        "https://www.science.org/x", "George Whitesides", [11, 12]
    )

    assert summary.startswith("(元記事の本文を読めなかったため")
    assert "日本語の要約" in summary
    assert "Comment number 11" in retriever.fake_client.calls[0]["contents"]


def test_unreadable_article_without_comments_says_so_in_japanese(
    monkeypatch: pytest.MonkeyPatch, retriever
) -> None:
    monkeypatch.setattr(hn.requests, "get", lambda url, **kwargs: FakeResponse(403))

    summary = retriever._summarize_story_url(
        "https://www.science.org/x", "George Whitesides", []
    )

    assert summary.startswith("元記事の本文を読めませんでした")
    assert "Error" not in summary
    assert retriever.fake_client.calls == []


def test_javascript_wall_is_treated_as_unreadable(
    monkeypatch: pytest.MonkeyPatch, retriever
) -> None:
    wall = "<html><body><main><p>Please enable JavaScript to continue using this application.</p></main></body></html>"
    monkeypatch.setattr(
        hn.requests, "get", lambda url, **kwargs: FakeResponse(200, wall)
    )

    _text, reason = retriever._fetch_article_text("https://example.com/app")

    assert reason is not None and "JavaScript" in reason


def test_story_links_to_the_hacker_news_discussion(retriever) -> None:
    story = hn.Story(
        title="T", score=100, url="https://example.com", text="要約", story_id=42
    )

    markdown = retriever._stylize_story(story)

    assert "[View Link](https://example.com)" in markdown
    assert (
        "[Hacker News のコメント](https://news.ycombinator.com/item?id=42)" in markdown
    )
