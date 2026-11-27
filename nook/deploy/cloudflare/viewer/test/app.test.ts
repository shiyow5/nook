import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { type AppDeps, handleRequest } from "../src/app";

const DAY = "2026-11-26";
const TECH_NEWS_MARKDOWN =
  "# First Article\n\n[View](https://example.com/first)\n\nAlpha.\n\n---\n\n# Second Article\n\nBeta.";

type RecordedCall = { url: string; init?: RequestInit };

function buildDeps(options: { responses?: Record<string, Response>; allow?: boolean } = {}) {
  const calls: RecordedCall[] = [];
  const deps: AppDeps = {
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      for (const [prefix, response] of Object.entries(options.responses ?? {})) {
        if (url.startsWith(prefix)) {
          return response.clone();
        }
      }
      return new Response("not found", { status: 404 });
    },
    verifyAccess: async () => options.allow ?? true,
    now: () => new Date("2026-11-26T03:00:00Z"),
  };
  return { deps, calls };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://nook-viewer.example.workers.dev${path}`, init);
}

const testEnv = () => ({
  ...env,
  GOOGLE_API_KEY: "test-google-key",
  GITHUB_TOKEN: "test-github-token",
  GITHUB_REPOSITORY: "someone/nook",
});

beforeEach(async () => {
  await env.NOOK_BUCKET.put(`tech_news/${DAY}.md`, TECH_NEWS_MARKDOWN);
});

describe("access control", () => {
  it("rejects requests without a valid Access token", async () => {
    const { deps } = buildDeps({ allow: false });

    const response = await handleRequest(request("/"), testEnv(), deps);

    expect(response.status).toBe(403);
  });
});

describe("GET /", () => {
  it("server-renders tabs, the first tab's articles and the viewer state", async () => {
    const { deps } = buildDeps();

    const response = await handleRequest(request(`/read?date=${DAY}`), testEnv(), deps);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('data-app-name="tech_news"');
    expect(html).toContain('<span class="tab-name">国内</span>');
    expect(html).toContain('class="md-heading md-h1"');
    expect(html).toContain("First Article");
    expect(html).not.toContain('id="weather"');
    const state = JSON.parse(html.split('<script id="viewer-state" type="application/json">')[1].split("</script>")[0]);
    expect(state.date).toBe(DAY);
    expect(state.app_names[0]).toBe("tech_news");
    expect(state.markdown_exists.tech_news).toBe(true);
    expect(state.markdown_exists.jp_tech_news).toBe(false);
    expect(state.articles.tech_news).toHaveLength(2);
  });

  it("lists one row per article and shows the first article with its source link", async () => {
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/read?date=${DAY}`), testEnv(), deps)).text();

    expect(html.match(/class="article-row"/g)).toHaveLength(2);
    expect(html).toContain('<span class="row-title">First Article</span>');
    expect(html).toContain('<span class="row-source">example.com</span>');
    expect(html).toContain('href="https://example.com/first" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('<span id="article-position">1 / 2</span>');
    expect(html).toContain('id="study-fab"');
    expect(html).toContain('id="chat-fab"');
    expect(html).toContain('id="chat-panel"');
    expect(html).not.toContain("marked.min.js");
    expect(html).toContain('<body data-view="list">');
    expect(html).toContain('id="study-backdrop" class="study-backdrop" hidden');
    expect(html).not.toContain('id="toc-list"');
  });

  it("uses a date picker that cannot go past today", async () => {
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/read?date=${DAY}`), testEnv(), deps)).text();

    expect(html).toContain(`type="date" value="${DAY}" max="${DAY}"`);
    expect(html).toMatch(/id="next-day"[^>]* disabled/);
    expect(html).toMatch(/id="today-button"[^>]* hidden/);
  });

  it("groups tabs into 国内 / 海外 / 論文 in the menu", async () => {
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/read?date=${DAY}`), testEnv(), deps)).text();

    const groups = [...html.matchAll(/<span class="tab-group-name">([^<]+)<\/span>/g)].map((match) => match[1]);
    expect(groups).toEqual(["国内", "海外", "論文"]);
    expect(html).toMatch(/data-app-name="tech_news" aria-current="page"/);
  });

  it("opens the tab given in the URL", async () => {
    // ほかのテストが「jp_tech_news は未収集」を前提にしているので、別の日に置く
    const otherDay = "2026-11-24";
    await env.NOOK_BUCKET.put(`jp_tech_news/${otherDay}.md`, "# 国内の記事\n\n[View on Zenn](https://zenn.dev/x)\n\n本文");
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/read?date=${otherDay}&tab=jp_tech_news`), testEnv(), deps)).text();

    expect(html).toMatch(/data-app-name="jp_tech_news" aria-current="page"/);
    expect(html).toContain('<span class="row-title">国内の記事</span>');
    const state = JSON.parse(html.split('<script id="viewer-state" type="application/json">')[1].split("</script>")[0]);
    expect(state.current_app).toBe("jp_tech_news");
    expect(state.tab_meta.jp_tech_news.group).toBe("国内");
  });

  it("falls back to the first tab when the URL names an unknown tab", async () => {
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/read?date=${DAY}&tab=nope`), testEnv(), deps)).text();

    expect(html).toMatch(/data-app-name="tech_news" aria-current="page"/);
  });

  it("uses today's date in Japan when no date is given", async () => {
    const { deps } = buildDeps();
    deps.now = () => new Date("2026-11-25T16:30:00Z"); // 2026-11-26 01:30 JST

    const html = await (await handleRequest(request("/read"), testEnv(), deps)).text();

    expect(html).toContain(`value="${DAY}"`);
  });

  it("escapes markup that would break out of the state script", async () => {
    await env.NOOK_BUCKET.put(`tech_news/${DAY}.md`, "# x</script><script>alert(1)</script>");
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/read?date=${DAY}`), testEnv(), deps)).text();

    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("rejects malformed dates", async () => {
    const { deps } = buildDeps();

    const response = await handleRequest(request("/?date=2026-13-40"), testEnv(), deps);

    expect(response.status).toBe(400);
  });
});

describe("GET /api/markdown/:app", () => {
  it("returns markdown, rendered articles and updated_at", async () => {
    const { deps } = buildDeps();

    const response = await handleRequest(request(`/api/markdown/tech_news?date=${DAY}`), testEnv(), deps);
    const payload = (await response.json()) as {
      markdown: string;
      articles: { article_id: string; title: string; html: string; headings: unknown[] }[];
      updated_at: string;
    };

    expect(response.status).toBe(200);
    expect(payload.markdown).toBe(TECH_NEWS_MARKDOWN);
    expect(payload.articles.map((article) => article.title)).toEqual(["First Article", "Second Article"]);
    expect(payload.articles[0].article_id).toMatch(/^article-tech_news-[0-9a-f]{12}$/);
    expect(payload.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps article ids stable across requests via R2 state", async () => {
    const { deps } = buildDeps();
    const path = `/api/markdown/tech_news?date=${DAY}`;

    const first = (await (await handleRequest(request(path), testEnv(), deps)).json()) as { articles: { article_id: string }[] };
    await env.NOOK_BUCKET.put(`tech_news/${DAY}.md`, `# Inserted\n\n---\n\n${TECH_NEWS_MARKDOWN}`);
    const second = (await (await handleRequest(request(path), testEnv(), deps)).json()) as { articles: { article_id: string }[] };

    expect(second.articles[1].article_id).toBe(first.articles[0].article_id);
    expect(await env.NOOK_BUCKET.get(`_state/tech_news/viewer-article-identity-${DAY}.json`)).not.toBeNull();
  });

  it("returns 404 for unknown apps, missing markdown and unchanged updated_at", async () => {
    const { deps } = buildDeps();
    const first = (await (await handleRequest(request(`/api/markdown/tech_news?date=${DAY}`), testEnv(), deps)).json()) as { updated_at: string };

    const unknown = await handleRequest(request(`/api/markdown/unknown?date=${DAY}`), testEnv(), deps);
    const missing = await handleRequest(request(`/api/markdown/jp_tech_news?date=${DAY}`), testEnv(), deps);
    const stale = await handleRequest(
      request(`/api/markdown/tech_news?date=${DAY}&previous_updated_at=${encodeURIComponent(first.updated_at)}`),
      testEnv(),
      deps,
    );

    expect([unknown.status, missing.status, stale.status]).toEqual([404, 404, 404]);
  });
});

describe("POST /chat/:app", () => {
  it("answers with Gemini grounded search using the selected article", async () => {
    const { deps, calls } = buildDeps({
      responses: {
        "https://example.com/first": new Response("<html><body><article>First body text</article></body></html>"),
        "https://generativelanguage.googleapis.com/": Response.json({
          candidates: [{ content: { parts: [{ text: "回答" }, { text: "です" }] } }],
        }),
      },
    });
    const markdown = (await (await handleRequest(request(`/api/markdown/tech_news?date=${DAY}`), testEnv(), deps)).json()) as {
      articles: { article_id: string }[];
    };

    const response = await handleRequest(
      request("/chat/tech_news", {
        method: "POST",
        body: JSON.stringify({
          article_id: markdown.articles[0].article_id,
          date: DAY,
          chat_history: "なし",
          message: "要点は?",
        }),
      }),
      testEnv(),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ response: "回答です", html: "<p>回答です</p>\n" });
    const geminiCall = calls.find((call) => call.url.startsWith("https://generativelanguage.googleapis.com/"));
    expect(geminiCall?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent",
    );
    const headers = new Headers(geminiCall?.init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("test-google-key");
    const body = JSON.parse(String(geminiCall?.init?.body));
    expect(body.tools).toEqual([{ google_search: {} }]);
    const prompt: string = body.contents[0].parts[0].text;
    expect(prompt).toContain("# First Article");
    expect(prompt).not.toContain("# Second Article");
    expect(prompt).toContain("First body text");
    expect(prompt).toContain("要点は?");
  });

  it("returns the answer as sanitized HTML so Markdown is rendered", async () => {
    const answer = "## 要点\n\n- **KV** キャッシュ\n\n<script>alert(1)</script>\n\n[危険](javascript:alert(1)) と [安全](https://example.com)";
    const { deps } = buildDeps({
      responses: {
        "https://generativelanguage.googleapis.com/": Response.json({ candidates: [{ content: { parts: [{ text: answer }] } }] }),
      },
    });
    const markdown = (await (await handleRequest(request(`/api/markdown/tech_news?date=${DAY}`), testEnv(), deps)).json()) as {
      articles: { article_id: string }[];
    };

    const response = await handleRequest(
      request("/chat/tech_news", {
        method: "POST",
        body: JSON.stringify({ article_id: markdown.articles[1].article_id, date: DAY, chat_history: "なし", message: "q" }),
      }),
      testEnv(),
      deps,
    );
    const { html } = (await response.json()) as { html: string };

    expect(html).toContain("<h2>要点</h2>");
    expect(html).toContain("<strong>KV</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">安全</a>');
  });

  it("returns 404 for an unknown article and 502 when Gemini fails", async () => {
    const { deps } = buildDeps({
      responses: { "https://generativelanguage.googleapis.com/": new Response("quota", { status: 429 }) },
    });
    const markdown = (await (await handleRequest(request(`/api/markdown/tech_news?date=${DAY}`), testEnv(), deps)).json()) as {
      articles: { article_id: string }[];
    };
    const chat = (articleId: string) =>
      handleRequest(
        request("/chat/tech_news", {
          method: "POST",
          body: JSON.stringify({ article_id: articleId, date: DAY, chat_history: "なし", message: "q" }),
        }),
        testEnv(),
        deps,
      );

    expect((await chat("article-missing")).status).toBe(404);
    expect((await chat(markdown.articles[1].article_id)).status).toBe(502);
  });
});

describe("POST /retry/:app", () => {
  it("dispatches the GitHub Actions workflow for that collector", async () => {
    const { deps, calls } = buildDeps({
      responses: { "https://api.github.com/": new Response(null, { status: 204 }) },
    });

    const response = await handleRequest(request("/retry/tech_news", { method: "POST" }), testEnv(), deps);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      message: "Job trigger for tech_news accepted. Processing started.",
      started_at: "2026-11-26T03:00:00.000Z",
    });
    expect(calls[0].url).toBe("https://api.github.com/repos/someone/nook/actions/workflows/collect.yml/dispatches");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer test-github-token");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ref: "main", inputs: { collectors: "tech_news" } });
  });

  it("returns 404 for unknown apps and 502 when GitHub rejects the dispatch", async () => {
    const { deps } = buildDeps({
      responses: { "https://api.github.com/": new Response("bad credentials", { status: 401 }) },
    });

    const unknown = await handleRequest(request("/retry/viewer", { method: "POST" }), testEnv(), deps);
    const rejected = await handleRequest(request("/retry/tech_news", { method: "POST" }), testEnv(), deps);

    expect(unknown.status).toBe(404);
    expect(rejected.status).toBe(502);
  });
});

describe("request hardening", () => {
  it("returns 404 instead of 500 for malformed percent-encoding", async () => {
    const { deps } = buildDeps();

    const response = await handleRequest(request("/api/markdown/%E0%A4%A"), testEnv(), deps);

    expect(response.status).toBe(404);
  });

  it("rejects cross-site POSTs to chat and retry", async () => {
    const { deps, calls } = buildDeps({
      responses: { "https://api.github.com/": new Response(null, { status: 204 }) },
    });
    const crossSite = { method: "POST", headers: { origin: "https://evil.example" } };

    const retry = await handleRequest(request("/retry/tech_news", crossSite), testEnv(), deps);
    const chat = await handleRequest(
      request("/chat/tech_news", { ...crossSite, body: JSON.stringify({ article_id: "x", message: "q" }) }),
      testEnv(),
      deps,
    );

    expect([retry.status, chat.status]).toEqual([403, 403]);
    expect(calls).toHaveLength(0);
  });

  it("accepts same-origin POSTs", async () => {
    const { deps } = buildDeps({
      responses: { "https://api.github.com/": new Response(null, { status: 204 }) },
    });

    const response = await handleRequest(
      request("/retry/tech_news", { method: "POST", headers: { origin: "https://nook-viewer.example.workers.dev" } }),
      testEnv(),
      deps,
    );

    expect(response.status).toBe(202);
  });
});

describe("static assets", () => {
  it("serves app.js and app.css under /static", async () => {
    const { deps } = buildDeps();

    const script = await handleRequest(request("/static/app.js"), testEnv(), deps);
    const style = await handleRequest(request("/static/app.css"), testEnv(), deps);

    expect(script.status).toBe(200);
    expect(await script.text()).toContain("startViewer");
    expect(style.status).toBe(200);
    expect(await style.text()).toContain(".study-fab");
  });
});

describe("home screen (#56)", () => {
  const homeDay = "2026-11-20";

  beforeEach(async () => {
    await env.NOOK_BUCKET.put(
      `jp_tech_news/${homeDay}.md`,
      "# 国内の一本目\n\n[View on Zenn Trending](https://zenn.dev/a)\n\n国内の要約です。&amp; 続き\n\n---\n\n# 国内の二本目\n\n本文",
    );
    await env.NOOK_BUCKET.put(`tech_news/${homeDay}.md`, TECH_NEWS_MARKDOWN);
    await env.NOOK_BUCKET.put(`arxiv_news/${homeDay}.md`, "# Paper A\n\n[View on arXiv cs.CL](https://arxiv.org/abs/1)\n\n論文の要約。");
  });

  it("shows the day's summary, one pick per group and a card per tab", async () => {
    const { deps } = buildDeps();

    const response = await handleRequest(request(`/?date=${homeDay}`), testEnv(), deps);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<body class="home-page">');
    expect(html).toContain("11月20日(金)のまとめ");
    expect(html).toContain("3 つのタブで 5 本");
    const picks = [...html.matchAll(/<span class="pick-tab">([^<]+)<\/span>/g)].map((match) => match[1]);
    expect(picks).toEqual(["国内", "News", "arXiv"]);
    expect(html).toContain('<span class="pick-lead">国内の要約です。&amp; 続き</span>');
    expect(html).toContain("まず読む 3 本");
    expect(html.match(/class="tab-card"/g)?.length).toBe(testEnv().VIEWER_SERVICES.split(",").length);
    expect(html).toContain("この日は新しい記事がありません。");
    expect(html).toMatch(/href="\/read\?tab=jp_tech_news&amp;date=2026-11-20&amp;article=[^"]+"/);
    expect(html).toContain("国内 の 2 本をすべて見る");
  });

  it("embeds every article of the day for the search box", async () => {
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/?date=${homeDay}`), testEnv(), deps)).text();

    const state = JSON.parse(html.split('<script id="home-state" type="application/json">')[1].split("</script>")[0]);
    expect(state.articles).toHaveLength(5);
    expect(state.articles.find((article: { label: string }) => article.label === "国内")).toMatchObject({ app_name: "jp_tech_news", label: "国内", title: "国内の一本目" });
  });

  it("uses the new menu with bookmarks, history and the glossary marked as 準備中", async () => {
    const { deps } = buildDeps();

    const home = await (await handleRequest(request(`/?date=${homeDay}`), testEnv(), deps)).text();
    const read = await (await handleRequest(request(`/read?date=${homeDay}&tab=tech_news`), testEnv(), deps)).text();

    for (const label of ["ブックマーク", "履歴", "用語辞書"]) {
      expect(home).toMatch(new RegExp(`aria-disabled="true">.*${label}.*準備中`));
    }
    expect(home).toMatch(/class="menu-item" href="\/\?date=2026-11-20" aria-current="page"/);
    expect(home).not.toMatch(/class="tab-item"[^>]*aria-current/);
    expect(read).toMatch(/class="tab-item" href="\/read\?tab=tech_news&amp;date=2026-11-20" data-app-name="tech_news" aria-current="page"/);
    expect(read).toContain('<a class="brand" href="/?date=2026-11-20">');
  });

  it("drops the date from links on today's page", async () => {
    const { deps } = buildDeps();

    const html = await (await handleRequest(request("/"), testEnv(), deps)).text();

    expect(html).toContain("1 つのタブで 2 本");
    expect(html).toContain('href="/read?tab=tech_news"');
  });

  it("redirects old /?tab= links to the detail screen", async () => {
    const { deps } = buildDeps();

    const response = await handleRequest(request(`/?tab=tech_news&date=${homeDay}`), testEnv(), deps);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://nook-viewer.example.workers.dev/read?tab=tech_news&date=${homeDay}`,
    );
  });
});

describe("home tab cards", () => {
  it("orders cards 国内 → 海外 → 論文 and puts empty tabs last", async () => {
    const day = "2026-11-19";
    await env.NOOK_BUCKET.put(`jp_tech_news/${day}.md`, "# a\n\nx");
    await env.NOOK_BUCKET.put(`tech_news/${day}.md`, "# b\n\ny");
    await env.NOOK_BUCKET.put(`arxiv_news/${day}.md`, "# c\n\nz");
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/?date=${day}`), testEnv(), deps)).text();

    const order = [...html.matchAll(/<article class="tab-card" data-app-name="([^"]+)"/g)].map((match) => match[1]);
    expect(order.slice(0, 3)).toEqual(["jp_tech_news", "tech_news", "arxiv_news"]);
  });
});

describe("loading screen (#55)", () => {
  it("sends the loading splash before the page body and hides it once the body arrives", async () => {
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/read?date=${DAY}`), testEnv(), deps)).text();

    const splash = html.indexOf('id="boot-splash"');
    const done = html.indexOf("<style>#boot-splash{display:none}</style>");
    expect(splash).toBeGreaterThan(html.indexOf("<body"));
    expect(done).toBeGreaterThan(splash);
    expect(html.indexOf('<header class="topbar">')).toBeGreaterThan(done);
    expect(html).toContain("今日の記事を集めています");
  });

  it("names the day when loading a past date", async () => {
    const { deps } = buildDeps();

    const html = await (await handleRequest(request("/?date=2026-11-20"), testEnv(), deps)).text();

    expect(html).toContain("11月20日の記事を集めています");
  });

  it("shows the reason and a reload link when R2 fails", async () => {
    const { deps } = buildDeps();
    const brokenEnv = {
      ...testEnv(),
      NOOK_BUCKET: {
        get: async () => {
          throw new Error("R2 is down");
        },
      } as unknown as R2Bucket,
    };

    const response = await handleRequest(request(`/read?date=${DAY}&tab=tech_news`), brokenEnv, deps);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("記事を読み込めませんでした");
    expect(html).toContain(`href="/read?date=${DAY}&amp;tab=tech_news"`);
    expect(html).not.toContain("R2 is down");
  });
});
