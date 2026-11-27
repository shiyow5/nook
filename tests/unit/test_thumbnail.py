from bs4 import BeautifulSoup

from nook.services.thumbnail import (
    first_figure_image,
    github_social_image,
    image_from_entry,
    image_from_soup,
    safe_image_url,
    thumbnail_markdown,
)


def test_safe_image_url_resolves_relative_paths_and_rejects_other_schemes() -> None:
    assert (
        safe_image_url("/a.png", "https://example.com/post/1")
        == "https://example.com/a.png"
    )
    assert safe_image_url("//cdn.example.com/a.png", "https://example.com/") == (
        "https://cdn.example.com/a.png"
    )
    assert safe_image_url("javascript:alert(1)") is None
    assert safe_image_url("data:image/png;base64,AAAA") is None
    assert safe_image_url("self") is None
    assert safe_image_url("") is None
    assert safe_image_url(None) is None


def test_image_from_soup_prefers_og_image_then_twitter_image() -> None:
    og = BeautifulSoup(
        '<meta name="twitter:image" content="https://x.com/t.png">'
        '<meta property="og:image" content="/og.png">',
        "html.parser",
    )
    twitter = BeautifulSoup(
        '<meta name="twitter:image" content="https://x.com/t.png">', "html.parser"
    )
    empty = BeautifulSoup("<p>no image</p>", "html.parser")

    assert (
        image_from_soup(og, "https://example.com/post") == "https://example.com/og.png"
    )
    assert image_from_soup(twitter, "https://example.com/post") == "https://x.com/t.png"
    assert image_from_soup(empty, "https://example.com/post") is None


def test_image_from_entry_reads_media_tags_enclosures_and_inline_images() -> None:
    assert image_from_entry(
        {"media_thumbnail": [{"url": "https://a.example/t.jpg"}]}
    ) == ("https://a.example/t.jpg")
    assert (
        image_from_entry(
            {"media_content": [{"url": "https://a.example/v.mp4", "type": "video/mp4"}]}
        )
        is None
    )
    assert (
        image_from_entry(
            {
                "links": [
                    {
                        "rel": "enclosure",
                        "type": "image/png",
                        "href": "https://a.example/e.png",
                    }
                ]
            }
        )
        == "https://a.example/e.png"
    )
    assert (
        image_from_entry(
            {"link": "https://blog.example/p", "summary": '<p>hi</p><img src="/i.png">'}
        )
        == "https://blog.example/i.png"
    )
    assert image_from_entry({"summary": "<p>text only</p>"}) is None


def test_first_figure_image_resolves_arxiv_relative_paths() -> None:
    html = (
        '<figure class="ltx_figure"><img src="2401.04088v1/images/smoe.png"></figure>'
    )

    assert first_figure_image(html, "https://arxiv.org/html/2401.04088") == (
        "https://arxiv.org/html/2401.04088v1/images/smoe.png"
    )
    assert first_figure_image("<p>no figure</p>", "https://arxiv.org/html/1") is None


def test_github_social_image() -> None:
    assert github_social_image("https://github.com/owner/repo") == (
        "https://opengraph.githubassets.com/1/owner/repo"
    )
    assert github_social_image("https://example.com/owner/repo") is None


def test_thumbnail_markdown_escapes_characters_that_break_markdown() -> None:
    assert thumbnail_markdown(None) == ""
    assert thumbnail_markdown("https://a.example/x (1).png") == (
        "![thumbnail](https://a.example/x%20%281%29.png)"
    )
