import { describe, expect, it } from "vitest";

import {
  assignArticleIds,
  extractArticleTitle,
  loadArticleIdentityState,
  serializeArticleIdentityState,
  splitMarkdownSections,
} from "../src/articles";
import { readLimitedText } from "../src/chat";
import { renderArticle, slugify } from "../src/render";

const TWO_ARTICLES =
  "# First Article\n\nAlpha summary.\n\n---\n\n# Second Article\n\nBeta summary.";

describe("splitMarkdownSections", () => {
  it("splits on --- lines and drops empty sections", () => {
    expect(splitMarkdownSections("\n---\n# A\n\nx\n---\n\n---\n# B\n---\n")).toEqual([
      "# A\n\nx",
      "# B",
    ]);
  });

  it("returns no sections for blank markdown", () => {
    expect(splitMarkdownSections("  \n ")).toEqual([]);
  });
});

describe("extractArticleTitle", () => {
  it("prefers the first heading, then the first line, then a fallback", () => {
    expect(extractArticleTitle("\n## Heading Title\nbody", 0)).toBe("Heading Title");
    expect(extractArticleTitle("plain line", 0)).toBe("plain line");
    expect(extractArticleTitle("x".repeat(100), 0)).toBe("x".repeat(80));
    expect(extractArticleTitle("   ", 2)).toBe("Article 3");
  });
});

describe("assignArticleIds", () => {
  it("uses the same sha256 fingerprint as the Python viewer", async () => {
    const [article] = await assignArticleIds("tech_feed", ["# A\n\nbody  "], []);
    // Python: _build_article_id(app_name="tech_feed", markdown_text="# A\n\nbody  ")
    expect(article.articleId).toBe("article-tech_feed-1ad32d93c17a");
    expect(article.title).toBe("A");
  });

  it("keeps existing ids when an article is inserted before them", async () => {
    const first = await assignArticleIds("tech_feed", ["# A", "# B"], []);
    const previous = JSON.parse(serializeArticleIdentityState(first)).articles;
    const second = await assignArticleIds("tech_feed", ["# New", "# A", "# B"], previous);

    expect(second[1].articleId).toBe(first[0].articleId);
    expect(second[2].articleId).toBe(first[1].articleId);
    expect(new Set(second.map((article) => article.articleId)).size).toBe(3);
  });

  it("gives duplicate content distinct ids", async () => {
    const articles = await assignArticleIds("tech_feed", ["# Same", "# Same"], []);

    expect(articles[0].articleId).not.toBe(articles[1].articleId);
    expect(articles[1].articleId).toBe(`${articles[0].articleId}-i2`);
  });
});

describe("article identity state", () => {
  it("round-trips through serialize and load", async () => {
    const articles = await assignArticleIds("tech_feed", splitMarkdownSections(TWO_ARTICLES), []);
    const entries = loadArticleIdentityState(serializeArticleIdentityState(articles));

    expect(entries.map((entry) => entry.article_id)).toEqual(
      articles.map((article) => article.articleId),
    );
    expect(entries[0].canonical_markdown).toBe("# First Article\n\nAlpha summary.");
  });

  it("returns an empty list when no state exists", () => {
    expect(loadArticleIdentityState(null)).toEqual([]);
  });

  it("rejects broken state instead of silently ignoring it", () => {
    expect(() => loadArticleIdentityState('{"version":2,"articles":[]}')).toThrow(
      /article identity state/,
    );
    expect(() =>
      loadArticleIdentityState(
        '{"version":1,"articles":[{"article_id":"a","canonical_markdown":"x"},{"article_id":"a","canonical_markdown":"y"}]}',
      ),
    ).toThrow(/unique/);
  });
});

describe("renderArticle", () => {
  it("renders markdown, adds heading anchors and collects headings", async () => {
    const rendered = await renderArticle(
      { articleId: "article-x", title: "T", markdown: "# 日本語 Title!\n\n## Sub\n\n## Sub\n\ntext" },
      0,
    );

    expect(rendered.headings).toEqual([
      { text: "日本語 Title!", anchor: "heading-article-x-0-日本語-title", level: 1 },
      { text: "Sub", anchor: "heading-article-x-0-sub", level: 2 },
      { text: "Sub", anchor: "heading-article-x-0-sub-2", level: 2 },
    ]);
    expect(rendered.html).toContain(
      '<h1 id="heading-article-x-0-日本語-title" class="md-heading md-h1">',
    );
  });

  it("removes dangerous tags, attributes and javascript links", async () => {
    const rendered = await renderArticle(
      {
        articleId: "article-x",
        title: "T",
        markdown:
          '<script>alert(1)</script><p onclick="x()" style="color:red">ok</p>\n\n' +
          '[bad](javascript:alert(1)) [good](https://example.com "t")\n\n' +
          '<img src="https://example.com/a.png" onerror="x()" alt="a">',
      },
      0,
    );

    expect(rendered.html).not.toContain("script");
    expect(rendered.html).not.toContain("onclick");
    expect(rendered.html).not.toContain("onerror");
    expect(rendered.html).not.toContain("style=");
    expect(rendered.html).not.toContain("javascript:");
    expect(rendered.html).toContain(
      '<a href="https://example.com" title="t" target="_blank" rel="noopener noreferrer">good</a>',
    );
    expect(rendered.html).toContain('<img src="https://example.com/a.png" alt="a">');
  });

  it.each([
    "javascript&colon;alert(1)",
    "java&Tab;script:alert(1)",
    "java&NewLine;script:alert(1)",
    "&#x6A;avascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "vbscript:msgbox(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
  ])("drops non-http(s) or obfuscated link targets: %s", async (href) => {
    const rendered = await renderArticle(
      { articleId: "a", title: "T", markdown: `<a href="${href}">x</a> <img src="${href}" alt="i">` },
      0,
    );

    expect(rendered.html).not.toContain("href=");
    expect(rendered.html).not.toContain("src=");
  });

  it.each([
    "https://example.com/a?x=1&amp;y=2",
    "http://example.com",
    "mailto:me@example.com",
    "/relative/path",
    "#section",
  ])("keeps safe link targets: %s", async (href) => {
    const rendered = await renderArticle({ articleId: "a", title: "T", markdown: `<a href="${href}">x</a>` }, 0);

    expect(rendered.html).toContain(`href="${href}"`);
  });

  it("decodes entities in heading text", async () => {
    const rendered = await renderArticle(
      { articleId: "a", title: "T", markdown: '# Q&A "tips" &lt;x&gt;' },
      1,
    );

    expect(rendered.headings[0].text).toBe('Q&A "tips" <x>');
  });
});

describe("readLimitedText", () => {
  it("stops reading once the byte limit is reached", async () => {
    const response = new Response("a".repeat(5000));

    expect(await readLimitedText(response, 1200)).toBe("a".repeat(1200));
  });

  it("returns the whole body when it fits", async () => {
    expect(await readLimitedText(new Response("短い本文"), 1000)).toBe("短い本文");
  });
});

describe("slugify", () => {
  it("matches the Python viewer's slug rules", () => {
    expect(slugify("日本語 Title!", 0)).toBe("日本語-title");
    expect(slugify("  Hello   World -- x ", 0)).toBe("hello-world-x");
    expect(slugify("!!!", 4)).toBe("section-4");
  });
});
