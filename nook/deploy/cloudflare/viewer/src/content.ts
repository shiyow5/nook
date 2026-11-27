// Python 版 nook/services/viewer/content.py の R2 読み書きと画面データ組み立てを移植したもの。
import {
  type ArticleState,
  articleIdentityStateKey,
  assignArticleIds,
  loadArticleIdentityState,
  serializeArticleIdentityState,
  splitMarkdownSections,
} from "./articles";
import { HttpError, type NookEnv } from "./env";
import { type Heading, type RenderedArticle, renderArticle } from "./render";

/** Python 版 nook/services/catalog.py の collector 一覧。 */
export const COLLECTOR_NAMES: ReadonlySet<string> = new Set([
  "hacker_news",
  "paper_summarizer",
  "reddit_explorer",
  "tech_feed",
  "github_trending",
  "product_hunt",
  "google_alerts",
  "tech_news",
  "jp_tech_news",
  "arxiv_news",
]);

const TAB_LABELS: Record<string, string> = {
  tech_news: "News",
  jp_tech_news: "国内",
  tech_feed: "Feeds",
  product_hunt: "ProductHunt",
  hacker_news: "HN",
  github_trending: "GitHub",
  reddit_explorer: "Reddit",
  paper_summarizer: "Papers",
  arxiv_news: "arXiv",
  google_alerts: "Alerts",
};

export type TabGroup = "国内" | "海外" | "論文";

/** ハンバーガーメニューでの分類と、タブ名の下に出す説明。 */
const TAB_META: Record<string, { group: TabGroup; description: string }> = {
  jp_tech_news: { group: "国内", description: "Zenn・Qiita・note・はてブ・DevelopersIO" },
  tech_news: { group: "海外", description: "海外メディア・企業ブログ・国内ビジネス" },
  tech_feed: { group: "海外", description: "企業・研究機関のブログ" },
  hacker_news: { group: "海外", description: "Hacker News の上位" },
  github_trending: { group: "海外", description: "GitHub Trending" },
  reddit_explorer: { group: "海外", description: "r/LocalLLaMA" },
  product_hunt: { group: "海外", description: "Product Hunt" },
  google_alerts: { group: "海外", description: "Google アラート" },
  paper_summarizer: { group: "論文", description: "Hugging Face Daily Papers" },
  arxiv_news: { group: "論文", description: "arXiv cs.CL / cs.LG / cs.AI" },
};

export const TAB_GROUP_ORDER: readonly TabGroup[] = ["国内", "海外", "論文"];

export type TabInfo = {
  appName: string;
  label: string;
  group: TabGroup;
  description: string;
  articleCount: number;
  isActive: boolean;
};

export type MarkdownRecord = { content: string; updatedAt: string | null };

export type ViewerPage = {
  date: string;
  appNames: string[];
  contents: Record<string, string>;
  articles: Record<string, RenderedArticle[]>;
  markdownExists: Record<string, boolean>;
  markdownUpdatedAt: Record<string, string | null>;
};

export type InitialRender = {
  currentApp: string | null;
  tabs: TabInfo[];
  articles: RenderedArticle[];
  missingMessage: string | null;
  headings: Heading[];
};

export function viewerServiceNames(env: Pick<NookEnv, "VIEWER_SERVICES">): string[] {
  const names = env.VIEWER_SERVICES.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names) {
    if (!COLLECTOR_NAMES.has(name)) {
      throw new Error(`VIEWER_SERVICES contains an unknown collector: ${name}`);
    }
  }
  return names;
}

export function displayLabel(appName: string): string {
  return TAB_LABELS[appName] ?? appName;
}

export function ensureViewerService(appNames: string[], appName: string): void {
  if (!appNames.includes(appName)) {
    throw new HttpError(404, "App not found");
  }
}

export async function readMarkdownRecord(bucket: R2Bucket, appName: string, day: string): Promise<MarkdownRecord | null> {
  const object = await bucket.get(`${appName}/${day}.md`);
  if (object === null) {
    return null;
  }
  return { content: await object.text(), updatedAt: object.uploaded.toISOString() };
}

export async function resolveArticleStates(
  bucket: R2Bucket,
  appName: string,
  day: string,
  markdownText: string,
): Promise<ArticleState[]> {
  const stateKey = `_state/${appName}/${articleIdentityStateKey(day)}`;
  const previousObject = await bucket.get(stateKey);
  const previousText = previousObject === null ? null : await previousObject.text();
  const sections = splitMarkdownSections(markdownText);
  const states = sections.length
    ? await assignArticleIds(appName, sections, loadArticleIdentityState(previousText))
    : [];
  const serialized = serializeArticleIdentityState(states);
  if (serialized !== previousText) {
    await bucket.put(stateKey, serialized, { httpMetadata: { contentType: "application/json" } });
  }
  return states;
}

export async function renderArticles(states: ArticleState[]): Promise<RenderedArticle[]> {
  return Promise.all(states.map((state, index) => renderArticle(state, index)));
}

export async function loadViewerPage(bucket: R2Bucket, appNames: string[], day: string): Promise<ViewerPage> {
  const entries = await Promise.all(
    appNames.map(async (appName) => {
      const record = await readMarkdownRecord(bucket, appName, day);
      const articles = record
        ? await renderArticles(await resolveArticleStates(bucket, appName, day, record.content))
        : [];
      return { appName, record, articles };
    }),
  );
  return {
    date: day,
    appNames,
    contents: Object.fromEntries(entries.map((entry) => [entry.appName, entry.record?.content ?? ""])),
    articles: Object.fromEntries(entries.map((entry) => [entry.appName, entry.articles])),
    markdownExists: Object.fromEntries(entries.map((entry) => [entry.appName, entry.record !== null])),
    markdownUpdatedAt: Object.fromEntries(entries.map((entry) => [entry.appName, entry.record?.updatedAt ?? null])),
  };
}

export function tabMeta(appName: string): { group: TabGroup; description: string } {
  return TAB_META[appName] ?? { group: "海外", description: "" };
}

/** 最初に開くタブ。URL の tab が表示対象ならそれを、なければ先頭のタブを使う。 */
export function resolveCurrentApp(appNames: string[], requested: string | null): string | null {
  if (requested !== null && appNames.includes(requested)) {
    return requested;
  }
  return appNames[0] ?? null;
}

export function buildInitialRender(page: ViewerPage, requestedApp: string | null = null): InitialRender {
  const currentApp = resolveCurrentApp(page.appNames, requestedApp);
  const tabs = page.appNames.map((appName) => ({
    appName,
    label: displayLabel(appName),
    ...tabMeta(appName),
    articleCount: page.articles[appName]?.length ?? 0,
    isActive: appName === currentApp,
  }));
  const articles = currentApp ? (page.articles[currentApp] ?? []) : [];
  if (currentApp === null || !page.markdownExists[currentApp] || articles.length === 0) {
    return {
      currentApp,
      tabs,
      articles: [],
      missingMessage: currentApp === null ? null : `${page.date} の ${displayLabel(currentApp)} はまだありません。`,
      headings: [],
    };
  }
  return {
    currentApp,
    tabs,
    articles,
    missingMessage: null,
    headings: articles.flatMap((article) => article.headings),
  };
}

export function articleToState(article: RenderedArticle) {
  return {
    article_id: article.articleId,
    title: article.title,
    html: article.html,
    headings: article.headings,
    source: article.source,
    link: article.link,
  };
}

export function pageToState(page: ViewerPage, extra: { currentApp?: string | null; today?: string } = {}) {
  return {
    date: page.date,
    today: extra.today ?? page.date,
    current_app: extra.currentApp ?? page.appNames[0] ?? null,
    app_names: page.appNames,
    tab_meta: Object.fromEntries(
      page.appNames.map((appName) => [appName, { label: displayLabel(appName), ...tabMeta(appName) }]),
    ),
    tab_group_order: TAB_GROUP_ORDER,
    contents: page.contents,
    articles: Object.fromEntries(
      Object.entries(page.articles).map(([appName, articles]) => [appName, articles.map(articleToState)]),
    ),
    markdown_exists: page.markdownExists,
    markdown_updated_at: page.markdownUpdatedAt,
    weather_data: {},
  };
}
