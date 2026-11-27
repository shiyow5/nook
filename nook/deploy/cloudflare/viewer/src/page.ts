// 読む画面の HTML。レイアウトは Design キャンバスの A+B 案(#6)に合わせている。
// 最初のタブの記事一覧と 1 本目の記事はサーバー側で描画し、残りは /static/app.js が受け持つ。
import type { InitialRender, TabInfo, ViewerPage } from "./content";
import { pageToState, TAB_GROUP_ORDER } from "./content";
import type { RenderedArticle } from "./render";
import { escapeHtml } from "./render";

const ICON_URL = "https://api.dicebear.com/7.x/shapes";

const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"></path>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
  panelClose: '<rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M9 4v16M15 10l-2 2 2 2"></path>',
  panelOpen: '<rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M9 4v16M13 10l2 2-2 2"></path>',
  settings:
    '<circle cx="12" cy="12" r="3"></circle><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>',
  book: '<path d="M4 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4zM20 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z"></path>',
};

function icon(name: keyof typeof ICONS, size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function renderIndexHtml(
  page: ViewerPage,
  initial: InitialRender,
  assetVersion: string,
  today: string = page.date,
): string {
  const version = encodeURIComponent(assetVersion);
  const currentTab = initial.tabs.find((tab) => tab.isActive) ?? null;
  const state = pageToState(page, { currentApp: initial.currentApp, today });
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nook</title>
  <link rel="icon" type="image/svg+xml" href="${ICON_URL}/svg?seed=nook">
  <link rel="apple-touch-icon" href="${ICON_URL}/png?seed=nook&amp;size=180">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/katex.min.css">
  <link rel="stylesheet" href="/static/app.css?v=${version}">
  <script defer src="https://cdn.jsdelivr.net/npm/marked@18.2.0/marked.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js"></script>
  <script defer src="/static/app.js?v=${version}"></script>
</head>
<body data-view="list">
  <header class="topbar">
    <button id="menu-button" class="icon-button" type="button" aria-label="タブのメニューを開く" aria-expanded="false" aria-controls="tab-drawer">${icon("menu")}</button>
    <a class="brand" href="/">
      <img src="${ICON_URL}/svg?seed=nook" alt="" width="26" height="26">
      <span class="brand-name">nook</span>
      <span class="brand-sep" aria-hidden="true">/</span>
      <span id="current-tab-label" class="brand-tab">${escapeHtml(currentTab?.label ?? "")}</span>
    </a>
    <form id="date-form" class="date-nav" action="/" method="get">
      <button id="prev-day" class="icon-button" type="button" aria-label="前の日">‹</button>
      <label class="date-field">
        ${icon("calendar", 18)}
        <span id="date-label" class="date-label" aria-hidden="true">${escapeHtml(formatDayLabel(page.date))}</span>
        <span class="visually-hidden">日付を選ぶ</span>
        <input id="date" name="date" type="date" value="${escapeHtml(page.date)}" max="${escapeHtml(today)}">
      </label>
      <button id="next-day" class="icon-button" type="button" aria-label="次の日"${page.date >= today ? " disabled" : ""}>›</button>
      <button id="today-button" class="text-button" type="button"${page.date === today ? " hidden" : ""}>今日</button>
      <input id="tab-field" type="hidden" name="tab" value="${escapeHtml(initial.currentApp ?? "")}">
      <noscript><button class="text-button" type="submit">表示</button></noscript>
    </form>
    <label class="filter-field">
      ${icon("search", 16)}
      <span class="visually-hidden">この日の記事を絞り込む</span>
      <input id="filter-input" type="search" placeholder="この日の記事を絞り込む" autocomplete="off">
    </label>
    <a id="settings-link" class="icon-button" href="/settings" aria-label="設定" title="設定">${icon("settings")}</a>
  </header>

  <div class="layout">
    <section id="list-panel" class="list-panel" aria-label="記事一覧">
      <div class="list-head">
        <div class="list-title">
          <span id="list-tab-label" class="list-tab">${escapeHtml(currentTab?.label ?? "")}</span>
          <span id="list-count" class="list-meta">${initial.articles.length} 件</span>
        </div>
        <button id="retry-button" class="text-button" type="button">再取得</button>
        <button id="list-close" class="text-button" type="button" aria-controls="list-panel" aria-expanded="true">${icon("panelClose", 16)}閉じる</button>
      </div>
      <p id="status-message" class="status-message" role="status" aria-live="polite"></p>
      <ol id="article-list" class="article-list">
${renderArticleList(initial.articles)}
      </ol>
      <p id="list-empty" class="empty-state"${initial.articles.length ? " hidden" : ""}>${escapeHtml(initial.missingMessage ?? "記事がありません。")}</p>
    </section>
    <div id="list-rail" class="list-rail" hidden>
      <button id="list-open" class="icon-button" type="button" aria-label="記事一覧を開く" aria-controls="list-panel" aria-expanded="false">${icon("panelOpen", 18)}</button>
      <span id="rail-position" class="rail-position"></span>
    </div>

    <main id="reader" class="reader">
${renderReader(initial.articles[0] ?? null, initial.articles.length)}
    </main>

    <aside id="study-panel" class="study-panel" aria-labelledby="study-title" hidden>
      <div class="study-head">
        <h2 id="study-title">今日の学び</h2>
        <button id="study-close" class="icon-button" type="button" aria-label="学びのパネルを閉じる">×</button>
      </div>
      <p id="study-article" class="study-article"></p>
      <div class="study-prompts" role="group" aria-label="よく使う質問">
        <button class="chip" type="button" data-prompt="この記事の要点を 3 行でまとめてください。">要点を 3 行で</button>
        <button class="chip" type="button" data-prompt="この記事を理解するための前提知識を、入門者向けに教えてください。">前提知識を教えて</button>
        <button class="chip" type="button" data-prompt="この記事に出てくる専門用語を 3〜5 個選び、それぞれ 1〜2 文で解説してください。">用語を解説して</button>
        <button class="chip" type="button" data-prompt="この記事の内容の理解度を確かめる 3 問のクイズを、解答と解説つきで出してください。">理解度チェック</button>
      </div>
      <div id="chat-log" class="chat-log" aria-live="polite"></div>
      <form id="chat-form" class="chat-form">
        <label for="chat-input" class="study-label">この記事について AI に聞く</label>
        <textarea id="chat-input" rows="3" placeholder="例: この手法は何が新しい?(Enter で送信、Shift+Enter で改行)"></textarea>
        <button id="chat-submit" class="primary-button" type="submit">送信</button>
      </form>
    </aside>
  </div>

  <div id="study-backdrop" class="study-backdrop" hidden></div>
  <button id="study-fab" class="study-fab" type="button" aria-label="今日の学びを開く" aria-controls="study-panel" aria-expanded="false" title="今日の学び">${icon("book", 26)}</button>

  <div id="drawer-backdrop" class="drawer-backdrop" hidden></div>
  <nav id="tab-drawer" class="tab-drawer" aria-label="タブ" hidden>
    <div class="drawer-head">
      <span class="drawer-title">タブ</span>
      <button id="drawer-close" class="icon-button" type="button" aria-label="メニューを閉じる">×</button>
    </div>
    <div id="tab-groups">
${renderTabGroups(initial.tabs)}
    </div>
  </nav>

  <script id="viewer-state" type="application/json">${serializeStateForScript(state)}</script>
</body>
</html>
`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 2026-11-27 → 2026年11月27日(金)。ブラウザの言語設定によらず同じ書き方にする。 */
export function formatDayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
  return `${year}年${month}月${date}日(${weekday})`;
}

/** <script> 内に埋め込んでも閉じタグや HTML として解釈されないよう JSON をエスケープする。 */
export function serializeStateForScript(state: unknown): string {
  return JSON.stringify(state)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

function renderTabGroups(tabs: TabInfo[]): string {
  return TAB_GROUP_ORDER.map((group) => {
    const members = tabs.filter((tab) => tab.group === group);
    if (members.length === 0) {
      return "";
    }
    const items = members
      .map(
        (tab) =>
          `        <button type="button" class="tab-item" data-app-name="${escapeHtml(tab.appName)}"${tab.isActive ? ' aria-current="page"' : ""}>
          <span class="tab-name">${escapeHtml(tab.label)}</span>
          <span class="tab-desc">${escapeHtml(tab.description)}</span>
          <span class="tab-count">${tab.articleCount} 件</span>
        </button>`,
      )
      .join("\n");
    return `      <div class="tab-group">
        <span class="tab-group-name">${group}</span>
${items}
      </div>`;
  })
    .filter(Boolean)
    .join("\n");
}

function renderArticleList(articles: RenderedArticle[]): string {
  return articles
    .map(
      (article, index) =>
        `        <li><button type="button" class="article-row" data-index="${index}"${index === 0 ? ' aria-current="true"' : ""}><span class="row-source">${escapeHtml(article.source ?? "")}</span><span class="row-title">${escapeHtml(article.title)}</span></button></li>`,
    )
    .join("\n");
}

function renderReader(article: RenderedArticle | null, total: number): string {
  if (article === null) {
    return '      <div id="reader-empty" class="empty-state reader-empty">表示できる記事がありません。日付やタブを変えてみてください。</div>';
  }
  const link = article.link
    ? `<a id="source-link" class="text-button" href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">元の記事を開く ↗</a>`
    : "";
  return `      <article id="article-view" class="article-view" data-article-id="${escapeHtml(article.articleId)}">
        <div class="article-meta">
          <span id="article-source" class="source-chip">${escapeHtml(article.source ?? "")}</span>
          <span id="article-position">1 / ${total}</span>
        </div>
        <div class="article-actions">${link}<button id="study-open" class="accent-button" type="button">この記事で学ぶ</button></div>
        <div id="article-body" class="article-body markdown-content">${article.html}</div>
        <div class="article-pager">
          <button id="prev-article" class="text-button" type="button" disabled>‹ 前の記事</button>
          <button id="next-article" class="primary-button" type="button"${total > 1 ? "" : " disabled"}>次の記事 ›</button>
        </div>
      </article>`;
}
