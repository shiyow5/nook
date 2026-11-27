from __future__ import annotations

from pydantic import BaseModel, Field


class PaperReference(BaseModel):
    title: str
    rationale: str
    url: str | None = None


class PaperSummarySections(BaseModel):
    title_ja: str = ""
    approach: list[str] = Field(default_factory=list)
    results: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    references: list[PaperReference] = Field(default_factory=list)


def render_paper_summary_markdown(
    *,
    title: str,
    url: str,
    summary: PaperSummarySections,
    thumbnail: str = "",
) -> str:
    return "\n\n".join(
        [
            f"# {title}",
            *_render_japanese_title(title=title, title_ja=summary.title_ja),
            f"[View Paper]({url})",
            *([thumbnail] if thumbnail else []),
            "### 1. どのようなアプローチで課題を解決しようとしたか",
            _render_bullet_list(
                summary.approach,
                empty_message="アプローチは抽出できなかった。",
            ),
            "### 2. 結果、何が達成できたのか",
            _render_bullet_list(
                summary.results,
                empty_message="結果は抽出できなかった。",
            ),
            "### 3. Limitationや問題点は何か",
            _render_bullet_list(
                summary.limitations,
                empty_message="問題点は抽出できなかった。",
            ),
            "### 4. 参考文献のうち、特に参照すべきもの",
            _render_references(summary.references),
        ]
    )


def _render_japanese_title(*, title: str, title_ja: str) -> list[str]:
    normalized_title_ja = title_ja.strip()
    if not normalized_title_ja or normalized_title_ja == title.strip():
        return []
    return [f"（{normalized_title_ja}）"]


def _render_bullet_list(items: list[str], *, empty_message: str) -> str:
    normalized_items = [item.strip() for item in items if item.strip()]
    if not normalized_items:
        normalized_items = [empty_message]
    return "\n".join(f"- {item}" for item in normalized_items)


def _render_references(references: list[PaperReference]) -> str:
    if not references:
        return "- 特に参照すべき文献は抽出できなかった。"

    lines: list[str] = []
    for reference in references:
        title = reference.title.strip()
        rationale = reference.rationale.strip()
        if reference.url:
            prefix = f"[{title}]({reference.url})"
        else:
            prefix = title
        lines.append(f"- {prefix}: {rationale}" if rationale else f"- {prefix}")
    return "\n".join(lines)
