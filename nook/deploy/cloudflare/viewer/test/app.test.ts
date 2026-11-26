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

    const response = await handleRequest(request(`/?date=${DAY}`), testEnv(), deps);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('data-app-name="tech_news"');
    expect(html).toContain(">国内</button>");
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

  it("uses today's date in Japan when no date is given", async () => {
    const { deps } = buildDeps();
    deps.now = () => new Date("2026-11-25T16:30:00Z"); // 2026-11-26 01:30 JST

    const html = await (await handleRequest(request("/"), testEnv(), deps)).text();

    expect(html).toContain(`value="${DAY}"`);
  });

  it("escapes markup that would break out of the state script", async () => {
    await env.NOOK_BUCKET.put(`tech_news/${DAY}.md`, "# x</script><script>alert(1)</script>");
    const { deps } = buildDeps();

    const html = await (await handleRequest(request(`/?date=${DAY}`), testEnv(), deps)).text();

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
    expect(await response.json()).toEqual({ response: "回答です" });
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
  it("serves viewer.js under /static", async () => {
    const { deps } = buildDeps();

    const response = await handleRequest(request("/static/viewer.js"), testEnv(), deps);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("bootstrapViewer");
  });
});
