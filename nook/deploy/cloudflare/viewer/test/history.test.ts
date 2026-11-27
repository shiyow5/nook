import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { type AppDeps, handleRequest } from "../src/app";

const DAY = "2026-11-21";
const ORIGIN = "https://nook-viewer.example.workers.dev";
const MARKDOWN =
  "# 読んだ記事\n\n[View on Zenn](https://zenn.dev/a)\n\n![thumbnail](https://img.example/a.png)\n\n本文です。\n\n---\n\n# もう一本\n\n本文";

let clock = new Date("2026-11-26T03:00:00Z");
const deps: AppDeps = {
  fetch: async () => new Response("not used", { status: 500 }),
  verifyAccess: async () => true,
  now: () => clock,
};

function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function recordRequest(articleId: string, origin = ORIGIN, app = "jp_tech_news"): Request {
  return request(`/api/history/${app}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ article_id: articleId, date: DAY }),
  });
}

async function articleIds(): Promise<string[]> {
  const html = await (await handleRequest(request(`/read?date=${DAY}&tab=jp_tech_news`), env, deps)).text();
  const state = JSON.parse(html.split('<script id="viewer-state" type="application/json">')[1].split("</script>")[0]);
  return state.articles.jp_tech_news.map((article: { article_id: string }) => article.article_id);
}

beforeEach(async () => {
  clock = new Date("2026-11-26T03:00:00Z");
  await env.NOOK_BUCKET.put(`jp_tech_news/${DAY}.md`, MARKDOWN);
  await env.DB.prepare("DELETE FROM reading_history").run();
});

describe("reading history (#73)", () => {
  it("records opened articles with the title read from R2 and lists them newest first", async () => {
    const [first, second] = await articleIds();

    const recorded = await handleRequest(recordRequest(first), env, deps);
    clock = new Date("2026-11-26T04:00:00Z");
    await handleRequest(recordRequest(second), env, deps);
    const html = await (await handleRequest(request("/history"), env, deps)).text();

    expect(recorded.status).toBe(200);
    expect(html.indexOf("もう一本")).toBeLessThan(html.indexOf("読んだ記事"));
    expect(html).toContain('<span id="history-count" class="home-section-note">2 本</span>');
    expect(html).toContain('<h2 class="history-day">今日</h2>');
    expect(html).toContain('class="thumb row-thumb" src="https://img.example/a.png"');
    expect(html).toContain(`href="/read?tab=jp_tech_news&amp;date=${DAY}&amp;article=${first}"`);
    expect(html).toContain("12:00");
  });

  it("updates the time and count when the same article is opened again", async () => {
    const [first] = await articleIds();
    await handleRequest(recordRequest(first), env, deps);
    clock = new Date("2026-11-27T01:30:00Z");
    await handleRequest(recordRequest(first), env, deps);

    const html = await (await handleRequest(request("/history"), env, deps)).text();

    expect(html).toContain('<span id="history-count" class="home-section-note">1 本</span>');
    expect(html).toContain("10:30 · 2 回目");
    expect(html).toContain('<h2 class="history-day">今日</h2>');
  });

  it("groups by the day the article was opened in Japan time", async () => {
    const [first, second] = await articleIds();
    clock = new Date("2026-11-24T16:00:00Z"); // 11/25 01:00 JST
    await handleRequest(recordRequest(first), env, deps);
    clock = new Date("2026-11-25T15:30:00Z"); // 11/26 00:30 JST
    await handleRequest(recordRequest(second), env, deps);
    clock = new Date("2026-11-26T03:00:00Z");

    const html = await (await handleRequest(request("/history"), env, deps)).text();

    expect(html).toContain('<h2 class="history-day">今日</h2>');
    expect(html).toContain('<h2 class="history-day">昨日 · 11月25日(水)</h2>');
  });

  it("deletes one entry or all entries", async () => {
    const [first, second] = await articleIds();
    await handleRequest(recordRequest(first), env, deps);
    await handleRequest(recordRequest(second), env, deps);

    const one = await handleRequest(
      request("/api/history/jp_tech_news", {
        method: "DELETE",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ article_id: first, date: DAY }),
      }),
      env,
      deps,
    );
    const afterOne = await (await handleRequest(request("/history"), env, deps)).text();
    const all = await handleRequest(request("/api/history", { method: "DELETE", headers: { origin: ORIGIN } }), env, deps);
    const afterAll = await (await handleRequest(request("/history"), env, deps)).text();

    expect(await one.json()).toEqual({ deleted: true });
    expect(afterOne).not.toContain("読んだ記事");
    expect(afterOne).toContain("もう一本");
    expect(await all.json()).toEqual({ deleted: true });
    expect(afterAll).toContain("まだ開いた記事はありません。");
  });

  it("drops entries older than 90 days when a new article is recorded", async () => {
    const [first, second] = await articleIds();
    clock = new Date("2026-08-01T03:00:00Z");
    await handleRequest(recordRequest(first), env, deps);
    clock = new Date("2026-11-26T03:00:00Z");
    await handleRequest(recordRequest(second), env, deps);

    const html = await (await handleRequest(request("/history"), env, deps)).text();

    expect(html).not.toContain("読んだ記事");
    expect(html).toContain("もう一本");
  });

  it("rejects cross-site writes, unknown articles and unknown tabs", async () => {
    const crossSite = await handleRequest(recordRequest("x", "https://evil.example"), env, deps);
    const unknownArticle = await handleRequest(recordRequest("article-nope"), env, deps);
    const unknownTab = await handleRequest(recordRequest("x", ORIGIN, "nope"), env, deps);
    const crossSiteClear = await handleRequest(
      request("/api/history", { method: "DELETE", headers: { origin: "https://evil.example" } }),
      env,
      deps,
    );

    expect(crossSite.status).toBe(403);
    expect(unknownArticle.status).toBe(404);
    expect(unknownTab.status).toBe(404);
    expect(crossSiteClear.status).toBe(403);
  });

  it("links 履歴 in the menu instead of showing 準備中", async () => {
    const html = await (await handleRequest(request("/"), env, deps)).text();
    const history = await (await handleRequest(request("/history"), env, deps)).text();

    expect(html).toContain('<a class="menu-item" href="/history">');
    expect(html).not.toContain("準備中");
    expect(history).toContain('<a class="menu-item" href="/history" aria-current="page">');
  });
});
