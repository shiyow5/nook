// 詳細画面(1 つのタブの一覧と本文)の HTML。レイアウトは Design キャンバスの A+B 案(#6)に合わせている。
// 最初のタブの記事一覧と 1 本目の記事はサーバー側で描画し、残りは /static/app.js が受け持つ。
import type { InitialRender, ViewerPage } from "./content";
import { pageToState } from "./content";
import type { RenderedArticle } from "./render";
import { escapeHtml, thumbnailHtml } from "./render";
import { ICON_URL, icon } from "./icons";
import { homePath, renderMenu } from "./menu";

export const INDEX_SHELL = {
  scripts: ["menu.js", "app.js"],
  extraStyles: ["https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/katex.min.css"],
  bodyAttributes: 'data-view="list"',
};

/** 詳細画面の本体(<body> の中身から </html> まで)。外枠は shell.ts が先に送る。 */
export function renderIndexBody(
  page: ViewerPage,
  initial: InitialRender,
  today: string = page.date,
  favorites: Record<string, string[]> = {},
): string {
  const currentTab = initial.tabs.find((tab) => tab.isActive) ?? null;
  const state = { ...pageToState(page, { currentApp: initial.currentApp, today }), favorites };
  const firstSaved = (favorites[initial.currentApp ?? ""] ?? []).includes(initial.articles[0]?.articleId ?? "");
  return `  <header class="topbar">
    <button id="menu-button" class="icon-button" type="button" aria-label="メニューを開く" aria-expanded="false" aria-controls="tab-drawer">${icon("menu")}</button>
    <a class="brand" href="${escapeHtml(homePath(page.date, today))}">
      <img src="${ICON_URL}/svg?seed=nook" alt="" width="26" height="26">
      <span class="brand-name">nook</span>
      <span class="brand-sep" aria-hidden="true">/</span>
      <span id="current-tab-label" class="brand-tab">${escapeHtml(currentTab?.label ?? "")}</span>
    </a>
    <a id="settings-link" class="icon-button" href="/settings" aria-label="設定" title="設定">${icon("settings")}</a>
    <div class="topbar-tools">
    <form id="date-form" class="date-nav" action="/read" method="get">
      <button id="prev-day" class="icon-button" type="button" aria-label="前の日">‹</button>
      <label class="date-field">
        ${icon("calendar", 18)}
        <span id="date-label" class="date-label" aria-hidden="true"><span class="date-label-full">${escapeHtml(formatDayLabel(page.date))}</span><span class="date-label-short">${escapeHtml(formatShortDayLabel(page.date))}</span></span>
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
    </div>
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
${renderReader(initial.articles[0] ?? null, initial.articles.length, firstSaved)}
    </main>

    <aside id="study-panel" class="study-panel" aria-labelledby="study-title" hidden>
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="study-head">
        <h2 id="study-title">今日の学び</h2>
        <button id="study-close" class="icon-button" type="button" aria-label="学びのパネルを閉じる">×</button>
      </div>
      <p id="study-article" class="study-article"></p>
      <section class="study-section" aria-labelledby="terms-title">
        <h3 id="terms-title" class="study-heading">この記事に出てきた言葉</h3>
        <div id="term-list" class="term-list" aria-live="polite"></div>
      </section>
      <section class="study-section" aria-label="理解度チェック">
        <button id="quiz-button" class="accent-solid-button study-wide" type="button">理解度チェック(3 問)</button>
        <div id="quiz-area" class="quiz-area" aria-live="polite"></div>
      </section>
      <button id="intro-button" class="text-button study-wide" type="button">入門の解説を読む</button>
    </aside>

    <aside id="chat-panel" class="study-panel chat-panel" aria-labelledby="chat-title" hidden>
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="study-head">
        <h2 id="chat-title">AI に聞く</h2>
        <button id="chat-close" class="icon-button" type="button" aria-label="AI チャットを閉じる">×</button>
      </div>
      <p id="chat-article" class="study-article"></p>
      <div class="study-prompts" role="group" aria-label="よく使う質問">
        <button class="chip" type="button" data-prompt="この記事の要点を 3 行でまとめてください。">要点を 3 行で</button>
        <button class="chip" type="button" data-prompt="この記事を理解するための前提知識を、入門者向けに教えてください。">前提知識を教えて</button>
      </div>
      <div id="chat-log" class="chat-log" aria-live="polite"></div>
      <form id="chat-form" class="chat-form">
        <label for="chat-input" class="visually-hidden">質問</label>
        <textarea id="chat-input" rows="3" placeholder="この記事について質問(Enter で送信、Shift+Enter で改行)"></textarea>
        <button id="chat-submit" class="primary-button" type="submit">送信</button>
      </form>
    </aside>
  </div>

  <div id="study-backdrop" class="study-backdrop" hidden></div>
  <button id="chat-fab" class="study-fab chat-fab" type="button" aria-label="AI チャットを開く" aria-controls="chat-panel" aria-expanded="false" title="AI に聞く">${icon("chat", 24)}</button>
  <button id="study-fab" class="study-fab" type="button" aria-label="今日の学びを開く" aria-controls="study-panel" aria-expanded="false" title="今日の学び">${icon("book", 26)}</button>

${renderMenu({ tabs: initial.tabs, page: "read", day: page.date, today })}

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

/** 2026-11-27 → 11月27日(金)。スマホのヘッダー用。 */
export function formatShortDayLabel(day: string): string {
  return formatDayLabel(day).replace(/^\d+年/, "");
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

function renderArticleList(articles: RenderedArticle[]): string {
  return articles
    .map(
      (article, index) =>
        `        <li><button type="button" class="article-row" data-index="${index}"${index === 0 ? ' aria-current="true"' : ""}><span class="row-text"><span class="row-source">${escapeHtml(article.source ?? "")}</span><span class="row-title">${escapeHtml(article.title)}</span></span>${thumbnailHtml(article.image, "row-thumb")}</button></li>`,
    )
    .join("\n");
}

/** お気に入りの切り替えボタン(#14)。押した後の表示は app.js が受け持つ。 */
export function favoriteButtonHtml(saved: boolean): string {
  return `<button id="favorite-button" class="text-button favorite-button" type="button" aria-pressed="${saved}">${saved ? "★ 保存済み" : "☆ 保存"}</button>`;
}

function renderReader(article: RenderedArticle | null, total: number, saved = false): string {
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
        <div class="article-actions">${link}${favoriteButtonHtml(saved)}<button id="study-open" class="accent-button" type="button">この記事で学ぶ</button></div>
${article.image ? `        <figure class="article-hero">${thumbnailHtml(article.image, "hero-image")}</figure>\n` : ""}        <div id="article-body" class="article-body markdown-content">${article.html}</div>
        <div class="article-pager">
          <button id="prev-article" class="text-button" type="button" disabled>‹ 前の記事</button>
          <button id="next-article" class="primary-button" type="button"${total > 1 ? "" : " disabled"}>次の記事 ›</button>
        </div>
      </article>`;
}
