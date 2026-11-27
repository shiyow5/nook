import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { type AppDeps, handleRequest } from "../src/app";

const ORIGIN = "https://nook-viewer.example.workers.dev";

function buildDeps(fetchFn: AppDeps["fetch"] = async () => new Response("unused", { status: 500 })) {
  const calls: string[] = [];
  const deps: AppDeps = {
    fetch: async (input, init) => {
      calls.push(String(input));
      return fetchFn(input, init);
    },
    verifyAccess: async () => true,
    now: () => new Date("2026-11-26T03:00:00Z"),
  };
  return { deps, calls };
}

function api(method: string, path: string, body?: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const testEnv = () => ({ ...env, GOOGLE_API_KEY: "test-google-key" });

describe("glossary (#17)", () => {
  it("adds, updates and deletes terms, merging the same word regardless of case", async () => {
    const { deps } = buildDeps();

    const first = await (
      await handleRequest(
        api("POST", "/api/terms", {
          word: "RAG",
          explanation: "検索拡張生成",
          app: "jp_tech_news",
          date: "2026-11-26",
          article_id: "article-jp_tech_news-1",
        }),
        testEnv(),
        deps,
      )
    ).json<{ term: { id: number; status: string; important: boolean } }>();
    const merged = await (
      await handleRequest(api("POST", "/api/terms", { word: "rag", explanation: "別の説明", important: true }), testEnv(), deps)
    ).json<{ term: { id: number; explanation: string; important: boolean; article_id: string } }>();
    const updated = await (
      await handleRequest(api("PATCH", `/api/terms/${first.term.id}`, { status: "understood", note: "メモ" }), testEnv(), deps)
    ).json<{ term: { status: string; note: string } }>();
    const page = await (await handleRequest(new Request(`${ORIGIN}/glossary`), testEnv(), deps)).text();
    await handleRequest(api("DELETE", `/api/terms/${first.term.id}`), testEnv(), deps);
    const afterDelete = await (await handleRequest(new Request(`${ORIGIN}/glossary`), testEnv(), deps)).text();

    expect(first.term).toMatchObject({ status: "learning", important: false });
    expect(merged.term).toMatchObject({ id: first.term.id, explanation: "検索拡張生成", important: true, article_id: "article-jp_tech_news-1" });
    expect(updated.term).toMatchObject({ status: "understood", note: "メモ" });
    const state = JSON.parse(page.split('<script id="glossary-state" type="application/json">')[1].split("</script>")[0]);
    expect(state.terms).toHaveLength(1);
    expect(state.terms[0]).toMatchObject({ word: "RAG", status: "understood", important: true });
    expect(page).toContain('<a class="menu-item" href="/glossary" aria-current="page">');
    const afterState = JSON.parse(afterDelete.split('<script id="glossary-state" type="application/json">')[1].split("</script>")[0]);
    expect(afterState.terms).toEqual([]);
  });

  it("validates input and rejects cross-site writes", async () => {
    const { deps } = buildDeps();

    const missing = await handleRequest(api("POST", "/api/terms", { word: "", explanation: "x" }), testEnv(), deps);
    const badStatus = await handleRequest(api("POST", "/api/terms", { word: "a", explanation: "x", status: "done" }), testEnv(), deps);
    const tooLong = await handleRequest(api("POST", "/api/terms", { word: "a".repeat(81), explanation: "x" }), testEnv(), deps);
    const crossSite = await handleRequest(api("POST", "/api/terms", { word: "a", explanation: "x" }, "https://evil.example"), testEnv(), deps);
    const emptyPatch = await handleRequest(api("PATCH", "/api/terms/1", {}), testEnv(), deps);
    const unknown = await handleRequest(api("PATCH", "/api/terms/999999", { note: "x" }), testEnv(), deps);

    expect([missing.status, badStatus.status, tooLong.status, crossSite.status, emptyPatch.status, unknown.status]).toEqual([
      400, 400, 400, 403, 400, 404,
    ]);
  });

  it("drafts an explanation with Gemini once and reuses the cached draft", async () => {
    const gemini = () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ reading: "べくとるでーたべーす", explanation: "ベクトルを検索するデータベース。" }) }] } }],
      });
    const { deps, calls } = buildDeps(async () => gemini());

    const first = await (await handleRequest(api("POST", "/api/terms/draft", { word: "Vector DB" }), testEnv(), deps)).json();
    const second = await (await handleRequest(api("POST", "/api/terms/draft", { word: "vector db" }), testEnv(), deps)).json();

    expect(first).toEqual({ reading: "べくとるでーたべーす", explanation: "ベクトルを検索するデータベース。" });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
  });
});

describe("select a word in the article (#16)", () => {
  it("ships the popup, the dialog and selection.js on the detail screen", async () => {
    await env.NOOK_BUCKET.put("tech_news/2026-11-26.md", "# A\n\n本文");
    const { deps } = buildDeps();

    const html = await (await handleRequest(new Request(`${ORIGIN}/read?date=2026-11-26`), testEnv(), deps)).text();

    expect(html).toMatch(/<script defer src="\/static\/selection.js\?v=[^"]+"><\/script>/);
    expect(html).toContain('id="selection-popup"');
    expect(html).toMatch(/<button type="button" data-mode="important">⭐ 重要<\/button>/);
    expect(html).toContain('<dialog id="term-dialog"');
  });
});
