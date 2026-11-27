import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { type AppDeps, handleRequest } from "../src/app";
import { DEFAULTS_KEY, SETTINGS_KEY, validateSettings } from "../src/settings";

const FEED = {
  name: "zenn-llm",
  feed_name_display: "Zenn LLM",
  url: "https://zenn.dev/topics/llm/feed",
  keywords: ["LLM"],
};

const DEFAULTS = {
  version: 1,
  collectors: ["hacker_news", "jp_tech_news", "reddit_explorer"],
  rss: { jp_tech_news: { max_entries_per_feed: 10, feeds: [FEED] } },
  generated_at: "2026-11-27T00:00:00Z",
};

const deps: AppDeps = {
  fetch: async () => new Response("unused", { status: 500 }),
  verifyAccess: async () => true,
  now: () => new Date("2026-11-27T03:00:00Z"),
};

const testEnv = () => ({ ...env, GOOGLE_API_KEY: "k", GITHUB_TOKEN: "t" });

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://nook-viewer.example.workers.dev/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://nook-viewer.example.workers.dev", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await env.NOOK_BUCKET.delete(SETTINGS_KEY);
  await env.NOOK_BUCKET.put(DEFAULTS_KEY, JSON.stringify(DEFAULTS));
});

describe("validateSettings", () => {
  it("accepts toggles and RSS feeds and trims keywords", () => {
    const settings = validateSettings({
      version: 1,
      collectors: { reddit_explorer: { enabled: false } },
      rss: { jp_tech_news: { max_entries_per_feed: 5, feeds: [{ ...FEED, keywords: [" 強化学習 ", "LLM"] }] } },
    });

    expect(settings.collectors.reddit_explorer.enabled).toBe(false);
    expect(settings.rss.jp_tech_news.feeds[0].keywords).toEqual(["強化学習", "LLM"]);
  });

  it.each([
    [{ version: 2 }, "version"],
    [{ version: 1, collectors: { unknown: { enabled: false } } }, "unknown"],
    [{ version: 1, collectors: { hacker_news: { enabled: "no" } } }, "enabled"],
    [{ version: 1, rss: { hacker_news: { max_entries_per_feed: 5, feeds: [FEED] } } }, "hacker_news"],
    [{ version: 1, rss: { jp_tech_news: { max_entries_per_feed: 0, feeds: [FEED] } } }, "上限"],
    [{ version: 1, rss: { jp_tech_news: { max_entries_per_feed: 5, feeds: [] } } }, "フィード"],
    [{ version: 1, rss: { jp_tech_news: { max_entries_per_feed: 5, feeds: [{ ...FEED, url: "javascript:alert(1)" }] } } }, "URL"],
    [{ version: 1, rss: { jp_tech_news: { max_entries_per_feed: 5, feeds: [{ ...FEED, keywords: [""] }] } } }, "キーワード"],
    [{ version: 1, rss: { jp_tech_news: { max_entries_per_feed: 5, feeds: [FEED, FEED] } } }, "重複"],
  ])("rejects %j", (input, message) => {
    expect(() => validateSettings(input)).toThrow(message);
  });
});

describe("settings API", () => {
  it("saves validated settings to R2 with a timestamp", async () => {
    const response = await handleRequest(
      post({ version: 1, collectors: { reddit_explorer: { enabled: false } }, rss: {} }),
      testEnv(),
      deps,
    );

    expect(response.status).toBe(200);
    const stored = JSON.parse((await (await env.NOOK_BUCKET.get(SETTINGS_KEY))!.text()));
    expect(stored.collectors.reddit_explorer.enabled).toBe(false);
    expect(stored.updated_at).toBe("2026-11-27T03:00:00.000Z");
  });

  it("rejects invalid settings and cross-site requests without saving", async () => {
    const invalid = await handleRequest(post({ version: 1, collectors: { x: { enabled: true } } }), testEnv(), deps);
    const crossSite = await handleRequest(
      post({ version: 1 }, { origin: "https://evil.example" }),
      testEnv(),
      deps,
    );

    expect(invalid.status).toBe(400);
    expect(crossSite.status).toBe(403);
    expect(await env.NOOK_BUCKET.get(SETTINGS_KEY)).toBeNull();
  });

  it("renders the settings page with defaults and saved settings", async () => {
    await env.NOOK_BUCKET.put(SETTINGS_KEY, JSON.stringify({ version: 1, collectors: { hacker_news: { enabled: false } }, rss: {} }));

    const response = await handleRequest(
      new Request("https://nook-viewer.example.workers.dev/settings"),
      testEnv(),
      deps,
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("/static/settings.js");
    const state = JSON.parse(html.split('<script id="settings-state" type="application/json">')[1].split("</script>")[0]);
    expect(state.defaults.collectors).toEqual(DEFAULTS.collectors);
    expect(state.settings.collectors.hacker_news.enabled).toBe(false);
    expect(state.tab_meta.jp_tech_news.label).toBe("国内");
  });

  it("links to the settings page from the reading page", async () => {
    const html = await (await handleRequest(new Request("https://nook-viewer.example.workers.dev/?date=2026-11-27"), testEnv(), deps)).text();

    expect(html).toContain('href="/settings"');
  });
});
