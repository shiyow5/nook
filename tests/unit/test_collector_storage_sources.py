from nook.services.collector_storage import (
    MAX_SOURCE_CHARS,
    CollectorStorage,
    source_text_key,
)


class _Backend:
    def __init__(self, fail: bool = False) -> None:
        self.states: dict[tuple[str, str], str] = {}
        self.fail = fail

    def write_state(self, service_name: str, key: str, content: str) -> None:
        if self.fail:
            raise RuntimeError("R2 is down")
        self.states[(service_name, key)] = content


def test_source_text_key_matches_the_viewer() -> None:
    # viewer の test/chat.test.ts でも同じ値を確かめている
    assert (
        source_text_key("https://example.com/a")
        == "2dce0a4c50441bfccfa9caf4b58c3cba.txt"
    )


def test_write_source_text_truncates_and_skips_empty_text() -> None:
    backend = _Backend()
    storage = CollectorStorage(service_name="tech_news", backend=backend)

    storage.write_source_text("https://example.com/a", "x" * (MAX_SOURCE_CHARS + 10))
    storage.write_source_text("https://example.com/b", "   ")
    storage.write_source_text(None, "text")

    assert list(backend.states) == [
        ("_sources", source_text_key("https://example.com/a"))
    ]
    assert len(next(iter(backend.states.values()))) == MAX_SOURCE_CHARS


def test_write_source_text_does_not_stop_collection_when_storage_fails() -> None:
    storage = CollectorStorage(service_name="tech_news", backend=_Backend(fail=True))

    storage.write_source_text("https://example.com/a", "text")
