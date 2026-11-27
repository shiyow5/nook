// 設定画面(#7)で編集する収集の設定。collector 側は nook/services/collector_settings.py が同じ形を読む。
import { COLLECTOR_NAMES } from "./content";
import { HttpError } from "./env";

export const SETTINGS_KEY = "_state/_settings/settings.json";
export const DEFAULTS_KEY = "_state/_settings/defaults.json";
/** フィードとキーワードを編集できる collector(Python の RSS_SERVICES と同じ)。 */
export const RSS_SERVICES: readonly string[] = ["tech_news", "jp_tech_news", "arxiv_news"];

const MAX_FEEDS = 50;
const MAX_KEYWORDS = 50;
const MAX_TEXT = 80;
const MAX_KEYWORD = 60;
const MAX_URL = 500;

export type FeedSetting = { name: string; feed_name_display: string; url: string; keywords: string[] | null };
export type RssSettings = { max_entries_per_feed: number; feeds: FeedSetting[] };
export type CollectorSettings = {
  version: 1;
  collectors: Record<string, { enabled: boolean }>;
  rss: Record<string, RssSettings>;
  updated_at?: string;
};

function fail(message: string): never {
  throw new HttpError(400, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    fail(`${field}は 1〜${max} 文字で入力してください`);
  }
  return value.trim();
}

function feedUrl(value: unknown): string {
  const raw = text(value, "フィードの URL ", MAX_URL);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`フィードの URL が正しくありません: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(`フィードの URL は http または https にしてください: ${raw}`);
  }
  return raw;
}

function keywords(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || value.length > MAX_KEYWORDS) {
    fail(`キーワードは 1 つのフィードに ${MAX_KEYWORDS} 個までです`);
  }
  const words = value.map((word) => text(word, "キーワード", MAX_KEYWORD));
  return words.length ? [...new Set(words)] : null;
}

function rssSettings(service: string, value: unknown): RssSettings {
  if (!RSS_SERVICES.includes(service)) {
    fail(`${service} はフィードを設定できない collector です`);
  }
  if (!isRecord(value)) {
    fail(`${service} の設定が正しくありません`);
  }
  const limit = value.max_entries_per_feed;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    fail("1 フィードあたりの上限は 1〜50 の整数にしてください");
  }
  if (!Array.isArray(value.feeds) || value.feeds.length === 0 || value.feeds.length > MAX_FEEDS) {
    fail(`フィードは 1〜${MAX_FEEDS} 件にしてください`);
  }
  const feeds = value.feeds.map((feed): FeedSetting => {
    if (!isRecord(feed)) {
      fail("フィードの形式が正しくありません");
    }
    return {
      name: text(feed.name, "フィードの ID ", MAX_TEXT),
      feed_name_display: text(feed.feed_name_display, "フィードの表示名", MAX_TEXT),
      url: feedUrl(feed.url),
      keywords: keywords(feed.keywords),
    };
  });
  for (const key of ["name", "url"] as const) {
    const values = feeds.map((feed) => feed[key]);
    if (new Set(values).size !== values.length) {
      fail(`同じフィードが重複しています(${key === "url" ? "URL" : "ID"})`);
    }
  }
  return { max_entries_per_feed: limit, feeds };
}

/** 画面から届いた設定を検証し、保存する形に整える。不正なら 400 の HttpError を投げる。 */
export function validateSettings(input: unknown): CollectorSettings {
  if (!isRecord(input) || input.version !== 1) {
    fail("設定の version が正しくありません");
  }
  const collectors: CollectorSettings["collectors"] = {};
  if (input.collectors !== undefined) {
    if (!isRecord(input.collectors)) {
      fail("collectors の形式が正しくありません");
    }
    for (const [name, toggle] of Object.entries(input.collectors)) {
      if (!COLLECTOR_NAMES.has(name)) {
        fail(`unknown collector: ${name}`);
      }
      if (!isRecord(toggle) || typeof toggle.enabled !== "boolean") {
        fail(`${name} の enabled は true か false にしてください`);
      }
      collectors[name] = { enabled: toggle.enabled };
    }
  }
  const rss: CollectorSettings["rss"] = {};
  if (input.rss !== undefined) {
    if (!isRecord(input.rss)) {
      fail("rss の形式が正しくありません");
    }
    for (const [service, value] of Object.entries(input.rss)) {
      rss[service] = rssSettings(service, value);
    }
  }
  return { version: 1, collectors, rss };
}

async function readJson(bucket: R2Bucket, key: string): Promise<unknown> {
  const object = await bucket.get(key);
  if (object === null) {
    return null;
  }
  try {
    return JSON.parse(await object.text());
  } catch {
    return null;
  }
}

export async function loadSettingsState(bucket: R2Bucket): Promise<{ defaults: unknown; settings: unknown }> {
  const [defaults, settings] = await Promise.all([readJson(bucket, DEFAULTS_KEY), readJson(bucket, SETTINGS_KEY)]);
  return { defaults, settings };
}

export async function saveSettings(bucket: R2Bucket, input: unknown, now: Date): Promise<CollectorSettings> {
  const settings = { ...validateSettings(input), updated_at: now.toISOString() };
  await bucket.put(SETTINGS_KEY, JSON.stringify(settings), {
    httpMetadata: { contentType: "application/json" },
  });
  return settings;
}
