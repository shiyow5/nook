from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

import nook.services.llm_client as llm_client
from nook.services.llm_response_cache import LlmResponseCache
from nook.services.storage import FilesystemStorageBackend


class _Summary(BaseModel):
    summary: str


def _install_counting_agent(
    monkeypatch: pytest.MonkeyPatch,
    outputs: list[object],
) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []

    class CountingAgent:
        def __init__(self, model: str, **kwargs: object) -> None:
            self._call = {"model": model, **kwargs}

        def run_sync(self, prompt: str) -> SimpleNamespace:
            calls.append({**self._call, "prompt": prompt})
            output = outputs[len(calls) - 1]
            if isinstance(output, Exception):
                raise output
            return SimpleNamespace(output=output)

    monkeypatch.setattr(
        llm_client, "export_runtime_secrets_to_env", lambda **kwargs: None
    )
    monkeypatch.setattr(llm_client, "Agent", CountingAgent)
    return calls


def _client(tmp_path: Path) -> llm_client.LlmClient:
    return llm_client.create_client(
        env={"LLM_MODEL": "openai:gpt-5.2"},
        response_cache=LlmResponseCache(FilesystemStorageBackend(data_dir=tmp_path)),
    )


def test_same_text_request_is_served_from_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = _install_counting_agent(monkeypatch, ["要約その1"])
    client = _client(tmp_path)

    first = client.generate_content(contents="本文", system_instruction="要約して")
    second = client.generate_content(contents="本文", system_instruction="要約して")

    assert first == second == "要約その1"
    assert len(calls) == 1
    assert len(list((tmp_path / "_state" / "llm_cache").glob("*.json"))) == 1


def test_cache_survives_a_new_client_instance(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = _install_counting_agent(monkeypatch, ["要約その1"])

    _client(tmp_path).generate_content(contents="本文", system_instruction="要約して")
    reused = _client(tmp_path).generate_content(
        contents="本文", system_instruction="要約して"
    )

    assert reused == "要約その1"
    assert len(calls) == 1


@pytest.mark.parametrize(
    "changed",
    [
        {"contents": "別の本文"},
        {"system_instruction": "別の指示"},
        {"model": "openai:gpt-5.2-mini"},
    ],
)
def test_different_input_or_model_is_not_served_from_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, changed: dict[str, str]
) -> None:
    calls = _install_counting_agent(monkeypatch, ["要約その1", "要約その2"])
    client = _client(tmp_path)
    request = {"contents": "本文", "system_instruction": "要約して"}

    client.generate_content(**request)
    second = client.generate_content(**{**request, **changed})

    assert second == "要約その2"
    assert len(calls) == 2


def test_failures_are_not_cached(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = _install_counting_agent(
        monkeypatch, [ValueError("invalid request"), "要約その1"]
    )
    client = _client(tmp_path)

    with pytest.raises(ValueError, match="invalid request"):
        client.generate_content(contents="本文", system_instruction="要約して")
    retried = client.generate_content(contents="本文", system_instruction="要約して")

    assert retried == "要約その1"
    assert len(calls) == 2


def test_structured_output_round_trips_through_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = _install_counting_agent(monkeypatch, [_Summary(summary="構造化")])
    client = _client(tmp_path)

    first = client.generate_structured_content(
        contents="本文", response_schema=_Summary, system_instruction="要約して"
    )
    second = client.generate_structured_content(
        contents="本文", response_schema=_Summary, system_instruction="要約して"
    )

    assert first == second == _Summary(summary="構造化")
    assert isinstance(second, _Summary)
    assert len(calls) == 1


def test_create_client_enables_cache_only_when_configured(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _install_counting_agent(monkeypatch, ["a", "b", "c"])
    base_env = {
        "LLM_MODEL": "openai:gpt-5.2",
        "NOOK_STORAGE_BACKEND": "filesystem",
        "NOOK_DATA_DIR": str(tmp_path),
    }

    disabled = llm_client.create_client(env=base_env)
    enabled = llm_client.create_client(
        env={**base_env, "NOOK_LLM_RESPONSE_CACHE": "enabled"}
    )

    assert disabled._response_cache is None
    assert isinstance(enabled._response_cache, LlmResponseCache)


def test_create_client_rejects_unknown_cache_setting() -> None:
    with pytest.raises(ValueError, match="NOOK_LLM_RESPONSE_CACHE"):
        llm_client.create_client(
            env={"LLM_MODEL": "openai:gpt-5.2", "NOOK_LLM_RESPONSE_CACHE": "yes"}
        )
