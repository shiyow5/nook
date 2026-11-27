import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from nook.services.storage import StorageBackend

DEFAULT_MARKDOWN_SEPARATOR = "\n\n---\n\n"
# collector が読んだ元記事の本文を、画面の AI チャット用に残す(#34)。
# viewer(chat.ts の sourceTextKey)も同じ規則でキーを作る
SOURCE_STATE_SERVICE = "_sources"
MAX_SOURCE_CHARS = 20_000


def source_text_key(url: str) -> str:
    return f"{hashlib.sha256(url.encode('utf-8')).hexdigest()[:32]}.txt"


@dataclass(slots=True)
class CollectorStorage:
    service_name: str
    backend: StorageBackend

    def write_daily_markdown(
        self,
        sections: Sequence[str],
        *,
        day: date | None = None,
        separator: str = DEFAULT_MARKDOWN_SEPARATOR,
    ) -> bool:
        if not sections:
            return False

        target_day = day or date.today()
        self.backend.write_markdown(
            service_name=self.service_name,
            day=target_day,
            content=separator.join(sections),
        )
        return True

    def read_state(self, key: str) -> str | None:
        return self.backend.read_state(self.service_name, key)

    def write_state(self, key: str, content: str) -> None:
        self.backend.write_state(self.service_name, key, content)

    def write_source_text(self, url: str | None, text: str | None) -> None:
        """元記事の本文を `_state/_sources/<URL のハッシュ>.txt` に残す。

        Workers からは読めないサイト(Reddit など)でも、チャットが本文を使えるようにするため。
        失敗しても収集は続ける。
        """
        if not url or not text or not text.strip():
            return
        try:
            self.backend.write_state(
                SOURCE_STATE_SERVICE, source_text_key(url), text[:MAX_SOURCE_CHARS]
            )
        except Exception as error:  # チャット用の補助データなので収集は止めない
            print(f"Failed to store source text for {url}: {error}")
