import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { type AppDeps, handleRequest } from "../src/app";
import { extractTags, indexDay, runArchiveIndexing } from "../src/archive";

const ORIGIN = "https://nook-viewer.example.workers.dev";
const APPS = ["jp_tech_news", "tech_news"];
const NOW = new Date("2026-11-26T03:00:00Z");

const JP = "# RAG の評価を自動化する\n\n[View on Zenn](https://zenn.dev/a)\n\nRAG の検索結果を LLM で採点する。\n\n---\n\n# 量子化で LLM を軽くする\n\n本文。LLM の量子化について。";
const NEWS = "# Nvidia pauses chip shipments\n\n[View on TechCrunch](https://tc.example/a)\n\nNvidia halts GPU exports.";

function deps(background?: (promise: Promise<unknown>) => void): AppDeps {
  return {
    fetch: async () => new Response("unused", { status: 500 }),
    verifyAccess: async () => true,
    now: () => NOW,
    background,
  };
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM archive_articles"), env.DB.prepare("DELETE FROM archive_days")]);
  await env.NOOK_BUCKET.put("jp_tech_news/2026-10-30.md", JP);
  await env.NOOK_BUCKET.put("tech_news/2026-11-02.md", NEWS);
});

async function indexBoth() {
  await indexDay({ db: env.DB, bucket: env.NOOK_BUCKET, appNames: APPS, day: "2026-10-30", now: NOW });
  await indexDay({ db: env.DB, bucket: env.NOOK_BUCKET, appNames: APPS, day: "2026-11-02", now: NOW });
}

describe("archive (#15)", () => {
  it("extracts tags from words that repeat, skipping stop words", () => {
    const tags = extractTags("RAG の評価を自動化する", "RAG の検索結果を LLM で採点する。");

    expect(tags[0]).toBe("RAG");
    expect(tags).toContain("LLM");
    expect(tags).not.toContain("する");
  });

  it("indexes a day once and skips it while the markdown is unchanged", async () => {
    const first = await indexDay({ db: env.DB, bucket: env.NOOK_BUCKET, appNames: APPS, day: "2026-10-30", now: NOW });
    const second = await indexDay({ db: env.DB, bucket: env.NOOK_BUCKET, appNames: APPS, day: "2026-10-30", now: NOW });

    expect(first).toBe(2);
    expect(second).toBe(0);
  });

  it("searches by words, tab, month, tag and order with paging", async () => {
    await indexBoth();
    const get = async (query: string) => (await handleRequest(new Request(`${ORIGIN}/archive${query}`), env, deps())).text();

    const all = await get("");
    const llm = await get("?q=LLM");
    const news = await get("?tab=tech_news");
    const october = await get("?month=2026-10&order=old");
    const tagged = await get("?tag=RAG");

    expect(all).toContain("2 日分から 3 本");
    expect(all.indexOf("Nvidia pauses")).toBeLessThan(all.indexOf("RAG の評価"));
    expect(llm.match(/class="archive-item"/g)).toHaveLength(2);
    expect(news.match(/class="archive-item"/g)).toHaveLength(1);
    expect(october).not.toContain("Nvidia pauses");
    expect(tagged).toContain("タグ #RAG で絞り込み中");
    expect(tagged.match(/class="archive-item"/g)).toHaveLength(1);
    expect(all).toContain('<a class="menu-item" href="/archive" aria-current="page">');
    expect(all).toContain('href="/read?tab=jp_tech_news&amp;date=2026-10-30&amp;article=');
  });

  it("escapes LIKE wildcards and rejects bad filters", async () => {
    await indexBoth();
    const percent = await (await handleRequest(new Request(`${ORIGIN}/archive?q=%25`), env, deps())).text();
    const badTab = await handleRequest(new Request(`${ORIGIN}/archive?tab=nope`), env, deps());
    const badMonth = await handleRequest(new Request(`${ORIGIN}/archive?month=2026-13`), env, deps());

    expect(percent).toContain("条件に合う記事がありません。");
    expect([badTab.status, badMonth.status]).toEqual([400, 400]);
  });

  it("refreshes the index in the background when the page is opened, and backfills past days", async () => {
    const tasks: Promise<unknown>[] = [];
    await handleRequest(new Request(`${ORIGIN}/archive`), env, deps((promise) => tasks.push(promise)));
    await Promise.all(tasks);
    const result = await runArchiveIndexing({
      db: env.DB,
      bucket: env.NOOK_BUCKET,
      appNames: APPS,
      today: "2026-11-26",
      now: NOW,
    });

    expect(tasks).toHaveLength(1);
    expect(result.days.slice(0, 2)).toEqual(["2026-11-26", "2026-11-25"]);
    expect(result.days).toHaveLength(8);
  });
});
