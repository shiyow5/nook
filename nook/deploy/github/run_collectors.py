import json
import sys
import time
import traceback
from collections.abc import Callable, Sequence

from nook.services.catalog import get_service_definition
from nook.services.registry import run_collector

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


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print(
            "usage: python -m nook.deploy.github.run_collectors <name,name,...>",
            file=sys.stderr,
        )
        return 2

    failed = run_collectors(parse_collector_names(args[0]))
    if failed:
        _log(event="collectors_failed", collectors=failed)
        return 1
    return 0


def _log(**fields: object) -> None:
    print(json.dumps(fields, ensure_ascii=False, default=str), flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
