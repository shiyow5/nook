"""arXiv の HTML 版(https://arxiv.org/html/<id>)から論文の本文を取り出す。

Papers タブ(paper_summarizer)と arXiv タブ(arxiv_news)が共通で使う。
"""

from bs4 import BeautifulSoup

ARXIV_HTML_URL = "https://arxiv.org/html/{arxiv_id}"

# 著者の所属欄などを本文の開始と誤認しないための語
_AFFILIATION_KEYWORDS = (
    "university",
    "lab",
    "department",
    "institute",
    "corresponding author",
)


def is_valid_body_line(line: str, min_length: int = 80) -> bool:
    """本文として妥当な行かを簡易に判定する。

    十分に長く、メールアドレスや所属を表す語を含まず、ピリオドを含む行を本文とみなす。
    """
    if "@" in line:
        return False
    lowered = line.lower()
    if any(keyword in lowered for keyword in _AFFILIATION_KEYWORDS):
        return False
    if len(line) < min_length:
        return False
    return "." in line


def extract_body_text(html: str, min_line_length: int = 40) -> str:
    """HTML から、最初の本文らしい行以降の十分に長い行だけを取り出す。"""
    soup = BeautifulSoup(html, "html.parser")
    body = soup.body
    if not body:
        return ""
    for tag in body.find_all(["header", "nav", "footer", "script", "style"]):
        tag.decompose()
    lines = body.get_text(separator="\n", strip=True).splitlines()

    start_index = 0
    for index, line in enumerate(lines):
        clean_line = line.strip()
        if len(clean_line) < min_line_length:
            continue
        if is_valid_body_line(clean_line, min_length=100):
            start_index = index
            break

    return "\n".join(
        line.strip().replace("Â", " ").strip()
        for line in lines[start_index:]
        if len(line.strip()) >= min_line_length
    )
