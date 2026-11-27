// メイン画面(ホーム、#56)。その日の全タブを見渡し、詳細画面(/read)へ移る入り口にする。
// レイアウトは Design キャンバスの「メイン画面(ホーム)」に合わせている。
import { displayLabel, TAB_GROUP_ORDER, type TabGroup, tabMeta, type ViewerPage } from "./content";
import { ICON_URL, icon } from "./icons";
import { homePath, readPath, renderMenu } from "./menu";
import { formatDayLabel, formatShortDayLabel, serializeStateForScript } from "./page";
import { decodeEntities, escapeHtml, type RenderedArticle, thumbnailHtml } from "./render";

/** タブのカードに並べる記事の数。 */
const TAB_CARD_ITEMS = 3;
const LEAD_MAX_CHARS = 120;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type HomeArticle = {
  appName: string;
  label: string;
  articleId: string;
  title: string;
  source: string | null;
  image: string | null;
  href: string;
};

export type HomePick = HomeArticle & { group: TabGroup; lead: string };

export type HomeTab = {
  appName: string;
  label: string;
  group: TabGroup;
  description: string;
  articleCount: number;
  items: HomeArticle[];
  href: string;
};

export type HomeData = {
  date: string;
  today: string;
  totalArticles: number;
  activeTabCount: number;
  /** その日の Markdown のうち、いちばん新しい保存時刻(日本時間の HH:MM)。なければ null。 */
  updatedAt: string | null;
  picks: HomePick[];
  tabs: HomeTab[];
  /** ホームの検索窓で絞り込む、その日の全記事。 */
  articles: HomeArticle[];
};

/** 記事の HTML から、見出しと「View」のリンクを除いた本文の冒頭を取り出す。 */
export function leadText(html: string, maxChars = LEAD_MAX_CHARS): string {
  const text = decodeEntities(
    html
      .replace(/<h[1-6]\b[\s\S]*?<\/h[1-6]\s*>/gi, " ")
      .replace(/<p>\s*<a\b[^>]*>\s*View\b[\s\S]*?<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

function toHomeArticle(appName: string, article: RenderedArticle, day: string, today: string): HomeArticle {
  return {
    appName,
    label: displayLabel(appName),
    articleId: article.articleId,
    title: article.title,
    source: article.source,
    image: article.image,
    href: readPath(appName, day, today, article.articleId),
  };
}

function latestUpdate(values: (string | null)[]): string | null {
  const times = values.filter((value): value is string => value !== null).map((value) => Date.parse(value));
  if (times.length === 0) {
    return null;
  }
  return new Date(Math.max(...times) + JST_OFFSET_MS).toISOString().slice(11, 16);
}

/**
 * 「まず読む」は国内・海外・論文から 1 本ずつ選ぶ。各分類で記事のある最初のタブ(VIEWER_SERVICES の順)の、
 * 先頭の記事を使う。collector が書き出した順のまま使い、LLM には選ばせない(費用と待ち時間を増やさないため)。
 */
export function buildHomeData(page: ViewerPage, today: string): HomeData {
  const day = page.date;
  const tabs = page.appNames.map((appName): HomeTab => {
    const articles = page.articles[appName] ?? [];
    return {
      appName,
      label: displayLabel(appName),
      ...tabMeta(appName),
      articleCount: articles.length,
      items: articles.slice(0, TAB_CARD_ITEMS).map((article) => toHomeArticle(appName, article, day, today)),
      href: readPath(appName, day, today),
    };
  });
  const picks = TAB_GROUP_ORDER.flatMap((group): HomePick[] => {
    const appName = page.appNames.find(
      (name) => tabMeta(name).group === group && (page.articles[name]?.length ?? 0) > 0,
    );
    const article = appName ? page.articles[appName][0] : undefined;
    if (!appName || !article) {
      return [];
    }
    return [{ ...toHomeArticle(appName, article, day, today), group, lead: leadText(article.html) }];
  });
  return {
    date: day,
    today,
    totalArticles: tabs.reduce((sum, tab) => sum + tab.articleCount, 0),
    activeTabCount: tabs.filter((tab) => tab.articleCount > 0).length,
    updatedAt: latestUpdate(page.appNames.map((name) => page.markdownUpdatedAt[name] ?? null)),
    picks,
    tabs: orderTabCards(tabs),
    articles: page.appNames.flatMap((appName) =>
      (page.articles[appName] ?? []).map((article) => toHomeArticle(appName, article, day, today)),
    ),
  };
}

/** タブのカードは 国内・海外・論文 の順に並べ、記事のないタブは後ろに回す。 */
function orderTabCards(tabs: HomeTab[]): HomeTab[] {
  const rank = (tab: HomeTab) => (tab.articleCount === 0 ? TAB_GROUP_ORDER.length : 0) + TAB_GROUP_ORDER.indexOf(tab.group);
  return tabs
    .map((tab, index) => ({ tab, index }))
    .sort((a, b) => rank(a.tab) - rank(b.tab) || a.index - b.index)
    .map(({ tab }) => tab);
}

export function homeToState(data: HomeData) {
  return {
    date: data.date,
    today: data.today,
    articles: data.articles.map((article) => ({
      app_name: article.appName,
      label: article.label,
      article_id: article.articleId,
      title: article.title,
      source: article.source,
      href: article.href,
    })),
  };
}

export const HOME_SHELL = { scripts: ["menu.js", "home.js"], bodyAttributes: 'class="home-page"' };

/** ホームの本体(<body> の中身から </html> まで)。外枠は shell.ts が先に送る。 */
export function renderHomeBody(data: HomeData): string {
  const { date, today } = data;
  const tabInfos = data.tabs.map((tab) => ({ ...tab, isActive: false }));
  return `  <header class="topbar">
    <button id="menu-button" class="icon-button" type="button" aria-label="メニューを開く" aria-expanded="false" aria-controls="tab-drawer">${icon("menu")}</button>
    <a class="brand" href="${escapeHtml(homePath(date, today))}">
      <img src="${ICON_URL}/svg?seed=nook" alt="" width="26" height="26">
      <span class="brand-name">nook</span>
      <span class="brand-sep" aria-hidden="true">/</span>
      <span class="brand-tab">ホーム</span>
    </a>
    <a id="settings-link" class="icon-button" href="/settings" aria-label="設定" title="設定">${icon("settings")}</a>
    <div class="topbar-tools">
    <form id="date-form" class="date-nav" action="/" method="get">
      <button id="prev-day" class="icon-button" type="button" aria-label="前の日">‹</button>
      <label class="date-field">
        ${icon("calendar", 18)}
        <span class="date-label" aria-hidden="true"><span class="date-label-full">${escapeHtml(formatDayLabel(date))}</span><span class="date-label-short">${escapeHtml(formatShortDayLabel(date))}</span></span>
        <span class="visually-hidden">日付を選ぶ</span>
        <input id="date" name="date" type="date" value="${escapeHtml(date)}" max="${escapeHtml(today)}">
      </label>
      <button id="next-day" class="icon-button" type="button" aria-label="次の日"${date >= today ? " disabled" : ""}>›</button>
      <button id="today-button" class="text-button" type="button"${date === today ? " hidden" : ""}>今日</button>
      <noscript><button class="text-button" type="submit">表示</button></noscript>
    </form>
    <label class="filter-field">
      ${icon("search", 16)}
      <span class="visually-hidden">この日の記事を検索</span>
      <input id="home-search" type="search" placeholder="この日の記事を検索" autocomplete="off">
    </label>
    </div>
  </header>

  <main class="home-main">
    <section class="home-summary" aria-labelledby="day-title">
      <div class="home-summary-text">
        <h1 id="day-title">${escapeHtml(formatShortDayLabel(date))}のまとめ</h1>
        <p class="home-summary-meta">${renderSummaryMeta(data)}</p>
      </div>
      <a id="resume-card" class="resume-card" href="/read" hidden>
        <span class="resume-icon">${icon("book")}</span>
        <span class="resume-text">
          <span id="resume-meta" class="resume-meta">続きから読む</span>
          <span id="resume-title" class="resume-title"></span>
        </span>
      </a>
    </section>

    <section id="search-results" class="home-section" aria-labelledby="search-title" hidden>
      <div class="home-section-head">
        <h2 id="search-title">検索の結果</h2>
        <span id="search-count" class="home-section-note"></span>
      </div>
      <ol id="search-list" class="home-list"></ol>
    </section>

    <div id="home-sections">
${renderPicks(data.picks)}
    <section class="home-section" aria-labelledby="tabs-title">
      <div class="home-section-head">
        <h2 id="tabs-title">タブごとの新着</h2>
        <span class="home-section-note">カードを押すと、そのタブの一覧と本文の画面に移ります</span>
      </div>
      <div class="tab-cards">
${data.tabs.map(renderTabCard).join("\n")}
      </div>
    </section>
    </div>
  </main>

${renderMenu({ tabs: tabInfos, page: "home", day: date, today })}

  <script id="home-state" type="application/json">${serializeStateForScript(homeToState(data))}</script>
</body>
</html>
`;
}

function renderSummaryMeta(data: HomeData): string {
  if (data.totalArticles === 0) {
    return "この日の記事はまだありません。";
  }
  const updated = data.updatedAt ? ` · 最終更新 ${data.updatedAt}` : "";
  return escapeHtml(`${data.activeTabCount} つのタブで ${data.totalArticles} 本${updated}`);
}

function renderPicks(picks: HomePick[]): string {
  if (picks.length === 0) {
    return "";
  }
  const cards = picks
    .map(
      (pick) => `        <a class="pick-card" href="${escapeHtml(pick.href)}">
${pick.image ? `          <span class="pick-image">${thumbnailHtml(pick.image, "pick-thumb")}</span>\n` : ""}          <span class="pick-meta"><span class="pick-tab">${escapeHtml(pick.label)}</span><span class="pick-source">${escapeHtml(pick.source ?? "")}</span></span>
          <span class="pick-title">${escapeHtml(pick.title)}</span>
          <span class="pick-lead">${escapeHtml(pick.lead)}</span>
          <span class="pick-foot"><span class="pick-read">読む →</span><span class="pick-badge">用語と理解度チェックつき</span></span>
        </a>`,
    )
    .join("\n");
  return `    <section class="home-section" aria-labelledby="picks-title">
      <div class="home-section-head">
        <h2 id="picks-title">まず読む ${picks.length} 本</h2>
        <span class="home-section-note">国内・海外・論文から 1 本ずつ</span>
      </div>
      <div class="pick-cards">
${cards}
      </div>
    </section>`;
}

function renderTabCard(tab: HomeTab): string {
  const body =
    tab.articleCount === 0
      ? '          <p class="tab-card-empty">この日は新しい記事がありません。</p>'
      : `          <ol class="tab-card-list">
${tab.items
  .map(
    (item) =>
      `            <li><a href="${escapeHtml(item.href)}"><span class="row-text"><span class="row-source">${escapeHtml(item.source ?? "")}</span><span class="row-title">${escapeHtml(item.title)}</span></span>${thumbnailHtml(item.image, "row-thumb")}</a></li>`,
  )
  .join("\n")}
          </ol>
          <a class="tab-card-more" href="${escapeHtml(tab.href)}">${escapeHtml(tab.label)} の ${tab.articleCount} 本をすべて見る</a>`;
  return `        <article class="tab-card" data-app-name="${escapeHtml(tab.appName)}">
          <div class="tab-card-head">
            <div class="tab-card-name">
              <span class="tab-card-group">${escapeHtml(tab.group)}</span>
              <h3><a href="${escapeHtml(tab.href)}">${escapeHtml(tab.label)}</a></h3>
              <span class="tab-card-desc">${escapeHtml(tab.description)}</span>
            </div>
            <span class="tab-card-count${tab.articleCount === 0 ? " is-empty" : ""}">${tab.articleCount} 本</span>
          </div>
${body}
        </article>`;
}
