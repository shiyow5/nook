import hashlib
import json
from dataclasses import dataclass
from typing import Any, Mapping

from nook.services.storage import StorageBackend, build_storage_backend

CACHE_SERVICE_NAME = "llm_cache"
CACHE_ENV = "NOOK_LLM_RESPONSE_CACHE"
CACHE_FORMAT_VERSION = 1


@dataclass(frozen=True, slots=True)
class LlmResponseCache:
    """LLM の応答を入力のハッシュで保存し、同じ入力の 2 回目以降で再利用する。

    保存するのは LLM が実際に返した結果だけで、失敗やエラー文は保存しない。
    保存先は collector と同じ StorageBackend(R2 では `_state/llm_cache/<hash>.json`)。
    """

    backend: StorageBackend

    @staticmethod
    def key_for(
        *,
        model: str,
        kind: str,
        contents: str | list[str],
        instructions: str | None,
        settings: Mapping[str, Any],
    ) -> str:
        payload = json.dumps(
            {
                "version": CACHE_FORMAT_VERSION,
                "model": model,
                "kind": kind,
                "contents": contents,
                "instructions": instructions,
                "settings": dict(settings),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def get(self, key: str) -> Any | None:
        raw = self.backend.read_state(CACHE_SERVICE_NAME, f"{key}.json")
        if raw is None:
            return None
        return json.loads(raw)["output"]

    def put(self, key: str, *, model: str, output: Any) -> None:
        self.backend.write_state(
            CACHE_SERVICE_NAME,
            f"{key}.json",
            json.dumps(
                {"version": CACHE_FORMAT_VERSION, "model": model, "output": output},
                ensure_ascii=False,
            ),
        )


def build_response_cache(env: Mapping[str, str | None]) -> LlmResponseCache | None:
    setting = env.get(CACHE_ENV)
    if setting in (None, "", "disabled"):
        return None
    if setting != "enabled":
        raise ValueError(f"{CACHE_ENV} must be 'enabled' or 'disabled': {setting}")
    return LlmResponseCache(build_storage_backend(env))
