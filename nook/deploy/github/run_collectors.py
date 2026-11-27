import json
import os
import sys
import time
import traceback
from collections.abc import Callable, Sequence
from datetime import date
from pathlib import Path

from nook.deploy.github.notify import notify_collection
from nook.services.catalog import get_service_definition
from nook.services.collector_settings import SettingsMode, apply_collector_settings
from nook.services.registry import run_collector
from nook.services.storage import StorageBackend, build_storage_backend

CollectorRunnerFn = Callable[[str], None]


def parse_collector_names(raw_names: str) -> list[str]:
    names = [name.strip() for name in raw_names.split(",") if name.strip()]
    if not names:
        raise ValueError("at least one collector name is required")

    for name in names:
        try:
            definition = get_service_definition(name)
        except KeyError as error:
            raise ValueError(f"unknown collector service: {name}") from error
        if definition.kind != "collector":
            raise ValueError(f"{name} is not a collector service")
    return names


def run_collectors(
    names: Sequence[str],
    runner: CollectorRunnerFn | None = None,
) -> list[str]:
    resolved_runner = runner or run_collector
    failed: list[str] = []
    for name in names:
        started = time.monotonic()
        try:
            resolved_runner(name)
        except Exception:
            print(traceback.format_exc(), file=sys.stderr)
            failed.append(name)
            status = "failed"
        else:
            status = "succeeded"
        _log(collector=name, status=status, seconds=time.monotonic() - started)
    return failed


def resolve_collector_names(
    names: Sequence[str],
    env: dict[str, str],
    backend_factory: Callable[[dict[str, str]], StorageBackend] = build_storage_backend,
) -> list[str]:
    """NOOK_COLLECTOR_SETTINGS が apply / publish のとき、画面の設定(#7)を反映する。

    apply は予定実行用で、設定画面で止めた collector を外す。publish は手動実行用で、
    指定された collector はそのまま動かし、設定画面用の既定値だけ書き出す。
    """
    mode = env.get("NOOK_COLLECTOR_SETTINGS", "").strip()
    if not mode:
        return list(names)
    if mode not in ("apply", "publish"):
        raise ValueError("NOOK_COLLECTOR_SETTINGS must be apply or publish")
    scheduled_raw = env.get("NOOK_SCHEDULED_COLLECTORS", "").strip()
    scheduled = parse_collector_names(scheduled_raw) if scheduled_raw else list(names)
    settings_mode: SettingsMode = "apply" if mode == "apply" else "publish"
    return apply_collector_settings(
        names, backend_factory(env), mode=settings_mode, scheduled=scheduled
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print(
            "usage: python -m nook.deploy.github.run_collectors <name,name,...>",
            file=sys.stderr,
        )
        return 2

    env = dict(os.environ)
    names = resolve_collector_names(parse_collector_names(args[0]), env)
    failed = run_collectors(names)
    sent = notify_collection(
        names=names,
        failed=failed,
        env=env,
        backend_factory=build_storage_backend,
        day=date.today(),
    )
    if sent and env.get("RUNNER_TEMP"):
        # ワークフローの失敗時の通知(collect.yml)が同じ内容を重ねて送らないための印
        Path(env["RUNNER_TEMP"], "nook-notified").touch()
    if failed:
        _log(event="collectors_failed", collectors=failed)
        return 1
    return 0


def _log(**fields: object) -> None:
    print(json.dumps(fields, ensure_ascii=False, default=str), flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
