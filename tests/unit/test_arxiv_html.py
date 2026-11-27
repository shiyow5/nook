from nook.services.arxiv_html import extract_body_text, is_valid_body_line


def test_extract_body_text_starts_at_first_sentence_like_line() -> None:
    html = """<html><body><nav>menu</nav>
    <p>Short title line</p>
    <p>Jane Doe, jane@example.com, Department of Physics, Example University, and a long affiliation line.</p>
    <p>Large language models are widely used, and this sentence is long enough to start the body text here.</p>
    <p>tiny</p>
    <p>The second paragraph continues the discussion of the method in enough detail to be kept.</p>
    </body></html>"""

    assert extract_body_text(html).splitlines() == [
        "Large language models are widely used, and this sentence is long enough to start the body text here.",
        "The second paragraph continues the discussion of the method in enough detail to be kept.",
    ]


def test_extract_body_text_returns_empty_for_page_without_body() -> None:
    assert extract_body_text("") == ""


def test_is_valid_body_line_rejects_affiliations_and_short_lines() -> None:
    long_sentence = (
        "This is a long sentence that describes the experimental setup in detail." * 2
    )
    assert is_valid_body_line(long_sentence)
    assert not is_valid_body_line("Department of " + long_sentence)
    assert not is_valid_body_line("contact: someone@example.com " + long_sentence)
    assert not is_valid_body_line("Too short.")
