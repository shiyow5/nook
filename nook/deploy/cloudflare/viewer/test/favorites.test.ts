import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { type AppDeps, handleRequest } from "../src/app";

const DAY = "2026-11-21";
const MARKDOWN =
  "# 保存する記事\n\n[View on Zenn](https://zenn.dev/a)\n\n![thumbnail](https://img.example/a.png)\n\n本文です。\n\n---\n\n# もう一本\n\n本文";

const deps: AppDeps = {
  fetch: async () => new Response("not used", { status: 500 }),
  verifyAccess: async () => true,
  now: () => new Date("2026-11-26T03:00:00Z"),
};

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://nook-viewer.example.workers.dev${path}`, init);
}

function favoriteRequest(method: "PUT" | "DELETE", articleId: string, origin = "https://nook-viewer.example.workers.dev") {
  return request("/api/favorites/jp_tech_news", {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ article_id: articleId, date: DAY }),
  });
}

async function firstArticleId(): Promise<string> {
  const html = await (await handleRequest(request(`/read?date=${DAY}&tab=jp_tech_news`), env, deps)).text();
  const state = JSON.parse(html.split('<script id="viewer-state" type="application/json">')[1].split("</script>")[0]);
  return state.articles.jp_tech_news[0].article_id;
}

beforeEach(async () => {
  await env.NOOK_BUCKET.put(`jp_tech_news/${DAY}.md`, MARKDOWN);
});

describe("favorites (#14)", () => {
  it("saves a copy of the article that survives the R2 markdown being deleted", async () => {
    const articleId = await firstArticleId();

    const saved = await handleRequest(favoriteRequest("PUT", articleId), env, deps);
    await env.NOOK_BUCKET.delete(`jp_tech_news/${DAY}.md`);
    const list = await (await handleRequest(request("/bookmarks"), env, deps)).text();
    const view = await (
      await handleRequest(request(`/bookmarks/view?tab=jp_tech_news&date=${DAY}&article=${articleId}`), env, deps)
    ).text();

    expect(saved.status).toBe(200);
    expect(list).toContain('<span class="row-title">保存する記事</span>');
    expect(list).toContain('<span id="bookmark-count" class="home-section-note">1 本</span>');
    expect(list).toContain('class="thumb row-thumb" src="https://img.example/a.png"');
    expect(view).toContain("本文です。");
    expect(view).toContain('<figure class="article-hero">');
    expect(view).toContain("この写しは残ります");
  });

  it("marks saved articles on the detail screen and removes them again", async () => {
    const articleId = await firstArticleId();
    await handleRequest(favoriteRequest("PUT", articleId), env, deps);
    await handleRequest(favoriteRequest("PUT", articleId), env, deps);

    const marked = await (await handleRequest(request(`/read?date=${DAY}&tab=jp_tech_news`), env, deps)).text();
    const removed = await handleRequest(favoriteRequest("DELETE", articleId), env, deps);
    const list = await (await handleRequest(request("/bookmarks"), env, deps)).text();

    expect(marked).toContain('aria-pressed="true" aria-label="ブックマークから外す"');
    const state = JSON.parse(marked.split('<script id="viewer-state" type="application/json">')[1].split("</script>")[0]);
    expect(state.favorites).toEqual({ jp_tech_news: [articleId] });
    expect(await removed.json()).toEqual({ saved: false });
    expect(list).toContain("まだ保存した記事はありません。");
  });

  it("rejects cross-site writes, unknown articles and unknown tabs", async () => {
    const crossSite = await handleRequest(favoriteRequest("PUT", "x", "https://evil.example"), env, deps);
    const unknownArticle = await handleRequest(favoriteRequest("PUT", "article-nope"), env, deps);
    const unknownTab = await handleRequest(
      request("/api/favorites/nope", {
        method: "PUT",
        headers: { origin: "https://nook-viewer.example.workers.dev" },
        body: JSON.stringify({ article_id: "x", date: DAY }),
      }),
      env,
      deps,
    );
    const missingView = await handleRequest(request(`/bookmarks/view?tab=jp_tech_news&date=${DAY}&article=x`), env, deps);

    expect(crossSite.status).toBe(403);
    expect(unknownArticle.status).toBe(404);
    expect(unknownTab.status).toBe(404);
    expect(missingView.status).toBe(404);
  });

  it("uses labelled icon-only buttons (#75)", async () => {
    const articleId = await firstArticleId();
    await handleRequest(favoriteRequest("PUT", articleId), env, deps);

    const read = await (await handleRequest(request(`/read?date=${DAY}&tab=jp_tech_news`), env, deps)).text();
    const list = await (await handleRequest(request("/bookmarks"), env, deps)).text();

    // 画面の JavaScript が参照するアイコンは、シェルに 1 度だけ埋め込む
    expect(read).toContain('<symbol id="icon-star"');
    expect(read).toContain('aria-label="元の記事を開く" title="元の記事を開く"><svg');
    expect(read).toContain('aria-label="次の記事" title="次の記事"><svg');
    expect(read).toContain('aria-label="このタブを再取得" title="このタブを再取得"><svg');
    expect(list).toContain('class="icon-button bookmark-remove" type="button" aria-label="ブックマークから外す" title="ブックマークから外す"><svg');
    expect(read).not.toContain("元の記事を開く ↗");
  });

  it("links ブックマーク in the menu instead of showing 準備中", async () => {
    const html = await (await handleRequest(request("/"), env, deps)).text();

    expect(html).toContain('<a class="menu-item" href="/bookmarks">');
    expect(html).not.toContain("準備中");
  });
});
