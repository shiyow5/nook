// ブックマーク画面(#14)。お気に入りした記事を、保存した新しい順に並べる。
// /bookmarks/view では D1 に残した本文の写しを表示するので、R2 の記事が消えた後も読める。
import { type TabInfo, displayLabel, tabMeta } from "./content";
import type { Favorite } from "./favorites";
import { ICON_URL, icon, iconButtonAttributes } from "./icons";
import { readPath, renderMenu } from "./menu";
import { formatDayLabel } from "./page";
import { escapeHtml, thumbnailHtml } from "./render";

export const BOOKMARKS_SHELL = { scripts: ["menu.js", "bookmarks.js"], bodyAttributes: 'class="bookmarks-page"' };

export function bookmarkViewPath(favorite: Pick<Favorite, "app" | "day" | "articleId">): string {
  const params = new URLSearchParams({ tab: favorite.app, date: favorite.day, article: favorite.articleId });
  return `/bookmarks/view?${params.toString()}`;
}

export function header(label: string): string {
  return `  <header class="topbar">
    <button id="menu-button" class="icon-button" type="button" aria-label="メニューを開く" aria-expanded="false" aria-controls="tab-drawer">${icon("menu")}</button>
    <a class="brand" href="/">
      <img src="${ICON_URL}/svg?seed=nook" alt="" width="26" height="26">
      <span class="brand-name">nook</span>
      <span class="brand-sep" aria-hidden="true">/</span>
      <span class="brand-tab">${escapeHtml(label)}</span>
    </a>
    <a id="settings-link" class="icon-button" href="/settings" aria-label="設定" title="設定">${icon("settings")}</a>
  </header>`;
}

export function menuTabs(appNames: string[]): TabInfo[] {
  // ブックマーク画面ではその日の件数を数えないので、件数の欄は出さない(0 件と誤解させない)
  return appNames.map((appName) => ({
    appName,
    label: displayLabel(appName),
    ...tabMeta(appName),
    articleCount: -1,
    isActive: false,
  }));
}

export function renderBookmarksBody(args: { favorites: Favorite[]; appNames: string[]; today: string }): string {
  const items = args.favorites.map((favorite) => renderBookmarkCard(favorite, args.today)).join("\n");
  return `${header("ブックマーク")}
  <main class="bookmarks-main">
    <div class="home-section-head">
      <h1 class="page-title">ブックマーク</h1>
      <span id="bookmark-count" class="home-section-note">${args.favorites.length} 本</span>
    </div>
    <p id="bookmark-empty" class="empty-state"${args.favorites.length ? " hidden" : ""}>まだ保存した記事はありません。詳細画面の「☆ 保存」を押すと、ここに並びます。</p>
    <ol id="bookmark-list" class="bookmark-list">
${items}
    </ol>
  </main>

${renderMenu({ tabs: menuTabs(args.appNames), page: "bookmarks", day: args.today, today: args.today })}
</body>
</html>
`;
}

function renderBookmarkCard(favorite: Favorite, today: string): string {
  const meta = [displayLabel(favorite.app), favorite.source].filter(Boolean).join(" · ");
  return `      <li class="bookmark-card" data-app-name="${escapeHtml(favorite.app)}" data-date="${escapeHtml(favorite.day)}" data-article-id="${escapeHtml(favorite.articleId)}">
        <a class="bookmark-main" href="${escapeHtml(bookmarkViewPath(favorite))}">
          <span class="row-text">
            <span class="row-source">${escapeHtml(meta)}</span>
            <span class="row-title">${escapeHtml(favorite.title)}</span>
            <span class="bookmark-day">${escapeHtml(formatDayLabel(favorite.day))}の記事</span>
          </span>
          ${thumbnailHtml(favorite.image, "row-thumb")}
        </a>
        <div class="bookmark-actions">
          <a class="text-button" href="${escapeHtml(readPath(favorite.app, favorite.day, today, favorite.articleId))}">詳細画面で開く</a>
          <button class="icon-button bookmark-remove" type="button" ${iconButtonAttributes("ブックマークから外す")}>${icon("trash", 18)}</button>
        </div>
      </li>`;
}

export function renderBookmarkViewBody(args: {
  favorite: Favorite;
  html: string;
  appNames: string[];
  today: string;
}): string {
  const { favorite } = args;
  const link = favorite.link
    ? `<a class="icon-button" href="${escapeHtml(favorite.link)}" target="_blank" rel="noopener noreferrer" ${iconButtonAttributes("元の記事を開く")}>${icon("external", 18)}</a>`
    : "";
  return `${header("ブックマーク")}
  <main class="bookmark-view">
    <a class="icon-button back-link" href="/bookmarks" ${iconButtonAttributes("ブックマーク一覧へ戻る")}>${icon("chevronLeft")}</a>
    <article class="article-view">
      <div class="article-meta">
        <span class="source-chip">${escapeHtml(favorite.source ?? displayLabel(favorite.app))}</span>
        <span>${escapeHtml(formatDayLabel(favorite.day))}の${escapeHtml(displayLabel(favorite.app))}</span>
      </div>
      <div class="article-actions">${link}<a class="accent-button" href="${escapeHtml(readPath(favorite.app, favorite.day, args.today, favorite.articleId))}">詳細画面で学ぶ</a></div>
${favorite.image ? `      <figure class="article-hero">${thumbnailHtml(favorite.image, "hero-image")}</figure>\n` : ""}      <div class="article-body markdown-content">${args.html}</div>
      <p class="bookmark-note">保存したときの本文の写しを表示しています。詳細画面の記事は 90 日で消えますが、この写しは残ります。</p>
    </article>
  </main>

${renderMenu({ tabs: menuTabs(args.appNames), page: "bookmarks", day: args.today, today: args.today })}
</body>
</html>
`;
}
