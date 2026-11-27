"""毎朝の収集の結果を Discord に知らせる(#22)。

Webhook の URL(Secrets の DISCORD_WEBHOOK_URL)が無ければ何もしない。予定実行では毎回、
手動実行(画面の再取得など)では失敗したときだけ送る。通知に失敗しても収集の結果は変えない。
"""

import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date

import requests

from nook.services.storage import StorageBackend
from nook.services.viewer.content import display_label

_TIMEOUT_SECONDS = 10
# Discord の 1 メッセージの上限は 2000 字
_MAX_CONTENT_CHARS = 1900
_PICKS = 3
_HEADING = re.compile(r"^# (.+)$", re.MULTILINE)
_VIEW_LINK = re.compile(r"\[View[^\]]*\]\((https?://[^)\s]+)\)")

PostFn = Callable[..., object]


@dataclass(frozen=True)
class TabResult:
    name: str
    count: int
    first_title: str | None
    first_link: str | None


def summarize_tab(name: str, markdown: str | None) -> TabResult:
    """その日の Markdown から記事数と先頭の記事を取り出す(各記事は「# 題名」で始まる)。"""
    if not markdown:
        return TabResult(name=name, count=0, first_title=None, first_link=None)
    titles = _HEADING.findall(markdown)
    first_section = markdown.split("\n---\n", 1)[0]
    link = _VIEW_LINK.search(first_section)
    return TabResult(
        name=name,
        count=len(titles),
        first_title=titles[0].strip() if titles else None,
        first_link=link.group(1) if link else None,
    )


def build_message(
    *,
    day: date,
    tabs: Sequence[TabResult],
    failed: Sequence[str],
    viewer_url: str | None,
    run_url: str | None,
) -> str:
    total = sum(tab.count for tab in tabs)
    lines = [f"**nook {day.month}/{day.day} の収集**  {total} 本"]
    counts = " / ".join(f"{display_label(tab.name)} {tab.count}" for tab in tabs)
    if counts:
        lines.append(counts)
    picks = [tab for tab in tabs if tab.first_title][:_PICKS]
    if picks:
        lines.append("")
        lines.append("注目")
        for tab in picks:
            title = tab.first_title or ""
            # <URL> にしてリンクのプレビュー(埋め込み)を出さない
            link = f" <{tab.first_link}>" if tab.first_link else ""
            lines.append(f"- [{display_label(tab.name)}] {title}{link}")
    if failed:
        lines.append("")
        lines.append(f"⚠️ 失敗: {', '.join(display_label(name) for name in failed)}")
        if run_url:
            lines.append(f"ログ: <{run_url}>")
    if viewer_url:
        lines.append("")
        lines.append(f"開く: <{viewer_url}>")
    content = "\n".join(lines)
    return (
        content
        if len(content) <= _MAX_CONTENT_CHARS
        else content[: _MAX_CONTENT_CHARS - 1] + "…"
    )


def should_notify(env: Mapping[str, str], failed: Sequence[str]) -> bool:
    if not env.get("DISCORD_WEBHOOK_URL", "").strip():
        return False
    scheduled = env.get("NOOK_COLLECTOR_SETTINGS", "").strip() == "apply"
    return scheduled or bool(failed)


def notify_collection(
    *,
    names: Sequence[str],
    failed: Sequence[str],
    env: Mapping[str, str],
    backend_factory: Callable[[Mapping[str, str]], StorageBackend],
    day: date,
    post: PostFn = requests.post,
) -> bool:
    """送ったら True。送らなかった・送れなかったら False(例外は出さない)。"""
    if not should_notify(env, failed):
        return False
    try:
        backend = backend_factory(env)
        tabs = [summarize_tab(name, backend.read_markdown(name, day)) for name in names]
        server = env.get("GITHUB_SERVER_URL", "")
        repository = env.get("GITHUB_REPOSITORY", "")
        run_id = env.get("GITHUB_RUN_ID", "")
        run_url = (
            f"{server}/{repository}/actions/runs/{run_id}"
            if server and repository and run_id
            else None
        )
        content = build_message(
            day=day,
            tabs=tabs,
            failed=failed,
            viewer_url=env.get("NOOK_VIEWER_URL", "").strip() or None,
            run_url=run_url,
        )
        response = post(
            env["DISCORD_WEBHOOK_URL"].strip(),
            data=json.dumps({"content": content, "allowed_mentions": {"parse": []}}),
            headers={"Content-Type": "application/json"},
            timeout=_TIMEOUT_SECONDS,
        )
        status = getattr(response, "status_code", 0)
        if not 200 <= status < 300:
            print(f"Discord notification failed: HTTP {status}")
            return False
        return True
    except Exception as error:  # 通知は補助なので、収集の成否に影響させない
        print(f"Discord notification failed: {type(error).__name__}")
        return False
