import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { type AppDeps, handleRequest } from "../src/app";
import { computeStats, shiftMonth } from "../src/calendar";

const ORIGIN = "https://nook-viewer.example.workers.dev";
const deps: AppDeps = {
  fetch: async () => new Response("unused", { status: 500 }),
  verifyAccess: async () => true,
  now: () => new Date("2026-11-26T03:00:00Z"), // 2026-11-26 12:00 JST
};

async function addSession(createdAt: string, articleId = "article-jp_tech_news-x", kind = "review") {
  await env.DB.prepare(
    "INSERT INTO ai_sessions (kind, app, day, article_id, input, output, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      kind,
      "jp_tech_news",
      "2026-11-24",
      articleId,
      JSON.stringify({ summary: "自分の要約" }),
      JSON.stringify({ understood: ["合っている点"], gaps: [], extras: ["補足"] }),
      createdAt,
    )
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM ai_sessions").run();
});

describe("learning calendar (#21)", () => {
  it("counts a streak that ends today or yesterday", () => {
    const days = [
      { day: "2026-11-23", count: 1 },
      { day: "2026-11-24", count: 2 },
      { day: "2026-11-25", count: 1 },
    ];

    expect(computeStats(days, "2026-11-25")).toEqual({ totalDays: 3, totalSessions: 4, streak: 3 });
    expect(computeStats(days, "2026-11-26").streak).toBe(3);
    expect(computeStats(days, "2026-11-27").streak).toBe(0);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("marks days in Japan time and shows that day's exchanges with the article title", async () => {
    await env.NOOK_BUCKET.put("jp_tech_news/2026-11-24.md", "# 記事の題名\n\n本文");
    const listed = await (await handleRequest(new Request(`${ORIGIN}/api/markdown/jp_tech_news?date=2026-11-24`), env, deps)).json<{
      articles: { article_id: string }[];
    }>();
    const articleId = listed.articles[0].article_id;
    // 2026-11-24 23:30 UTC は日本時間で 11-25
    await addSession("2026-11-24T23:30:00.000Z", articleId);
    await addSession("2026-11-25T01:00:00.000Z", articleId);
    await addSession("2026-11-26T00:10:00.000Z", articleId);

    const html = await (await handleRequest(new Request(`${ORIGIN}/calendar?day=2026-11-25`), env, deps)).text();

    expect(html).toContain("<dt>連続</dt><dd>2 日</dd>");
    expect(html).toContain("<dt>相談した回数</dt><dd>3 回</dd>");
    expect(html).toMatch(/class="cal-cell is-active is-selected" href="\/calendar\?month=2026-11&amp;day=2026-11-25"[^>]*><span class="cal-date">25<\/span><span class="cal-count">2<\/span>/);
    expect(html).toContain("国内 · 記事の題名");
    expect(html.match(/class="day-session"/g)).toHaveLength(2);
    expect(html).toContain(`href="/read?tab=jp_tech_news&amp;date=2026-11-24&amp;article=${articleId}"`);
    expect(html).toContain('<a class="menu-item" href="/calendar" aria-current="page">');
  });

  it("moves between months and rejects bad months", async () => {
    const html = await (await handleRequest(new Request(`${ORIGIN}/calendar?month=2026-10`), env, deps)).text();
    const bad = await handleRequest(new Request(`${ORIGIN}/calendar?month=2026-13`), env, deps);

    expect(html).toContain("2026年10月");
    expect(html).toContain('href="/calendar?month=2026-09" aria-label="前の月"');
    expect(html).toContain('href="/calendar?month=2026-11">今月</a>');
    expect(bad.status).toBe(400);
  });
});
