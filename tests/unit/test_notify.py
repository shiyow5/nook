from datetime import date

from nook.deploy.github.notify import build_message, notify_collection, summarize_tab
from nook.services.storage import FilesystemStorageBackend

DAY = date(2026, 11, 27)
JP = "\n# 迷惑メール対策\n\n[View on Zenn](https://zenn.dev/a)\n\n要約\n\n---\n\n# 二本目\n\n本文"
HN = "\n# Intel One Mono\n\n**Score**: 480\n\n[View Link](https://github.com/intel/one-mono)\n\n要約"


class _Response:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


def _backend(tmp_path):
    backend = FilesystemStorageBackend(data_dir=tmp_path)
    backend.write_markdown("jp_tech_news", DAY, JP)
    backend.write_markdown("hacker_news", DAY, HN)
    return backend


def test_summarize_tab_counts_articles_and_takes_the_first_link() -> None:
    tab = summarize_tab("jp_tech_news", JP)

    assert (tab.count, tab.first_title, tab.first_link) == (
        2,
        "迷惑メール対策",
        "https://zenn.dev/a",
    )
    assert summarize_tab("tech_feed", None).count == 0


def test_message_lists_counts_picks_failures_and_links() -> None:
    message = build_message(
        day=DAY,
        tabs=[
            summarize_tab("jp_tech_news", JP),
            summarize_tab("hacker_news", HN),
            summarize_tab("tech_feed", None),
        ],
        failed=["reddit_explorer"],
        viewer_url="https://nook.example",
        run_url="https://github.com/o/r/actions/runs/1",
    )

    assert message.startswith("**nook 11/27 の収集**  3 本")
    assert "国内 2 / HN 1 / Feeds 0" in message
    assert "- [国内] 迷惑メール対策 <https://zenn.dev/a>" in message
    assert "⚠️ 失敗: Reddit" in message
    assert "ログ: <https://github.com/o/r/actions/runs/1>" in message
    assert message.endswith("開く: <https://nook.example>")


def test_notifies_scheduled_runs_and_only_failures_of_manual_runs(tmp_path) -> None:
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return _Response(204)

    base = {"DISCORD_WEBHOOK_URL": "https://discord.example/hook"}
    args = {
        "names": ["jp_tech_news", "hacker_news"],
        "backend_factory": lambda env: _backend(tmp_path),
        "day": DAY,
        "post": post,
    }

    scheduled = notify_collection(
        failed=[], env={**base, "NOOK_COLLECTOR_SETTINGS": "apply"}, **args
    )
    manual_ok = notify_collection(
        failed=[], env={**base, "NOOK_COLLECTOR_SETTINGS": "publish"}, **args
    )
    manual_failed = notify_collection(
        failed=["hacker_news"],
        env={**base, "NOOK_COLLECTOR_SETTINGS": "publish"},
        **args,
    )
    no_hook = notify_collection(
        failed=["hacker_news"], env={"NOOK_COLLECTOR_SETTINGS": "apply"}, **args
    )

    assert (scheduled, manual_ok, manual_failed, no_hook) == (True, False, True, False)
    assert len(calls) == 2
    assert calls[0][0] == "https://discord.example/hook"
    assert '"parse": []' in calls[0][1]["data"]


def test_notification_errors_do_not_raise_or_leak_the_url(tmp_path, capsys) -> None:
    def post(url, **kwargs):
        raise RuntimeError(f"failed to reach {url}")

    sent = notify_collection(
        names=["jp_tech_news"],
        failed=[],
        env={
            "DISCORD_WEBHOOK_URL": "https://discord.example/secret-hook",
            "NOOK_COLLECTOR_SETTINGS": "apply",
        },
        backend_factory=lambda env: _backend(tmp_path),
        day=DAY,
        post=post,
    )

    assert sent is False
    assert "secret-hook" not in capsys.readouterr().out
