// アーカイブ画面(#15)。検索・タブ・年月・タグ・並び順で絞り込み、20 件ずつページを送る。
// カードとリストの切り替えは /static/archive.js が受け持つ(サーバーは同じ HTML を返す)。
import type { ArchiveArticle, ArchiveQuery, ArchiveResult } from "./archive";
import { ARCHIVE_PAGE_SIZE } from "./archive";
import { displayLabel, type TabInfo, tabMeta } from "./content";
import { ICON_URL, icon } from "./icons";
import { readPath, renderMenu } from "./menu";
import { formatDayLabel } from "./page";
import { escapeHtml, thumbnailHtml } from "./render";

export const ARCHIVE_SHELL = { scripts: ["menu.js", "archive.js"], bodyAttributes: 'class="archive-page"' };

function archivePath(query: ArchiveQuery, changes: Partial<ArchiveQuery>): string {
  const next = { ...query, page: 1, ...changes };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.tab) params.set("tab", next.tab);
  if (next.month) params.set("month", next.month);
  if (next.tag) params.set("tag", next.tag);
  if (next.order === "old") params.set("order", "old");
  if (next.page > 1) params.set("page", String(next.page));
  const search = params.toString();
  return search ? `/archive?${search}` : "/archive";
}

function option(value: string, label: string, selected: string | null): string {
  return `<option value="${escapeHtml(value)}"${value === (selected ?? "") ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function card(article: ArchiveArticle, today: string, query: ArchiveQuery): string {
  const tags = article.tags
    .slice(0, 4)
    .map((tag) => `<a class="archive-tag" href="${escapeHtml(archivePath(query, { tag }))}">#${escapeHtml(tag)}</a>`)
    .join("");
  return `      <li class="archive-item">
        <a class="archive-main" href="${escapeHtml(readPath(article.app, article.day, today, article.articleId))}">
          ${thumbnailHtml(article.image, "archive-thumb")}
          <span class="row-text">
            <span class="row-source">${escapeHtml([displayLabel(article.app), article.source].filter(Boolean).join(" · "))}</span>
            <span class="row-title">${escapeHtml(article.title)}</span>
            <span class="archive-lead">${escapeHtml(article.lead)}</span>
            <span class="bookmark-day">${escapeHtml(formatDayLabel(article.day))}</span>
          </span>
        </a>
        ${tags ? `<div class="archive-tags">${tags}</div>` : ""}
      </li>`;
}

export function renderArchiveBody(args: {
  query: ArchiveQuery;
  result: ArchiveResult;
  appNames: string[];
  today: string;
}): string {
  const { query, result } = args;
  const tabs: TabInfo[] = args.appNames.map((appName) => ({
    appName,
    label: displayLabel(appName),
    ...tabMeta(appName),
    articleCount: -1,
    isActive: false,
  }));
  const pages = Math.max(1, Math.ceil(result.total / ARCHIVE_PAGE_SIZE));
  const pager =
    pages > 1
      ? `    <nav class="archive-pager" aria-label="ページ">
      ${query.page > 1 ? `<a class="text-button" href="${escapeHtml(archivePath(query, { page: query.page - 1 }))}">‹ 前へ</a>` : ""}
      <span>${query.page} / ${pages}</span>
      ${query.page < pages ? `<a class="text-button" href="${escapeHtml(archivePath(query, { page: query.page + 1 }))}">次へ ›</a>` : ""}
    </nav>`
      : "";
  const tagChips = result.tags
    .map(
      (entry) =>
        `<a class="chip" href="${escapeHtml(archivePath(query, { tag: entry.tag === query.tag ? null : entry.tag }))}" aria-pressed="${entry.tag === query.tag}">#${escapeHtml(entry.tag)} <span class="chip-count">${entry.count}</span></a>`,
    )
    .join("");
  const empty =
    result.indexedDays === 0
      ? "アーカイブの索引をまだ作っています。毎朝の収集のあとに入り、過去の日も少しずつ増えます。"
      : "条件に合う記事がありません。";
  return `  <header class="topbar">
    <button id="menu-button" class="icon-button" type="button" aria-label="メニューを開く" aria-expanded="false" aria-controls="tab-drawer">${icon("menu")}</button>
    <a class="brand" href="/">
      <img src="${ICON_URL}/svg?seed=nook" alt="" width="26" height="26">
      <span class="brand-name">nook</span>
      <span class="brand-sep" aria-hidden="true">/</span>
      <span class="brand-tab">アーカイブ</span>
    </a>
    <a id="settings-link" class="icon-button" href="/settings" aria-label="設定" title="設定">${icon("settings")}</a>
  </header>
  <main class="archive-main">
    <div class="glossary-head">
      <h1 class="page-title">アーカイブ</h1>
      <span class="home-section-note">${result.indexedDays} 日分から ${result.total} 本</span>
    </div>
    <form class="archive-filters" action="/archive" method="get">
      <label class="filter-field">
        ${icon("search", 16)}
        <span class="visually-hidden">題名と要約を検索</span>
        <input name="q" type="search" value="${escapeHtml(query.q)}" placeholder="題名と要約を検索" autocomplete="off">
      </label>
      <label class="glossary-select">タブ
        <select name="tab">${option("", "すべて", query.tab)}${args.appNames.map((app) => option(app, displayLabel(app), query.tab)).join("")}</select>
      </label>
      <label class="glossary-select">年月
        <select name="month">${option("", "すべて", query.month)}${result.months.map((month) => option(month, month.replace("-", "年") + "月", query.month)).join("")}</select>
      </label>
      <label class="glossary-select">並び
        <select name="order">${option("new", "新しい順", query.order)}${option("old", "古い順", query.order)}</select>
      </label>
      ${query.tag ? `<input type="hidden" name="tag" value="${escapeHtml(query.tag)}">` : ""}
      <button class="primary-button" type="submit">絞り込む</button>
      <div class="segmented" role="group" aria-label="表示の形">
        <button id="archive-view-cards" type="button" aria-pressed="true">カード</button>
        <button id="archive-view-list" type="button" aria-pressed="false">リスト</button>
      </div>
    </form>
    ${query.tag ? `<p class="archive-active-tag">タグ #${escapeHtml(query.tag)} で絞り込み中 <a class="text-button" href="${escapeHtml(archivePath(query, { tag: null }))}">外す</a></p>` : ""}
    ${tagChips ? `<div class="glossary-index archive-tag-cloud" aria-label="よく出る語">${tagChips}</div>` : ""}
    <ol id="archive-list" class="archive-list is-cards">
${result.articles.map((article) => card(article, args.today, query)).join("\n")}
    </ol>
    ${result.articles.length ? "" : `<p class="empty-state">${escapeHtml(empty)}</p>`}
${pager}
  </main>

${renderMenu({ tabs, page: "archive", day: args.today, today: args.today })}
</body>
</html>
`;
}
