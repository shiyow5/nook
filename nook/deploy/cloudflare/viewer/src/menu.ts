// ハンバーガーメニュー(#56)。ホームと詳細画面で同じものを出す。開閉は /static/menu.js が受け持つ。
import { type TabInfo, TAB_GROUP_ORDER } from "./content";
import { icon } from "./icons";
import { escapeHtml } from "./render";

export type MenuPage = "home" | "read" | "bookmarks" | "glossary";

/** 詳細画面の URL。今日の日付は省き、ブックマークしやすい短い形にする。 */
export function readPath(appName: string, day: string, today: string, articleId?: string): string {
  const params = new URLSearchParams({ tab: appName });
  if (day !== today) {
    params.set("date", day);
  }
  if (articleId) {
    params.set("article", articleId);
  }
  return `/read?${params.toString()}`;
}

export function homePath(day: string, today: string): string {
  return day === today ? "/" : `/?date=${encodeURIComponent(day)}`;
}

export function renderMenu(args: { tabs: TabInfo[]; page: MenuPage; day: string; today: string }): string {
  const current = (page: MenuPage) => (args.page === page ? ' aria-current="page"' : "");
  return `  <div id="drawer-backdrop" class="drawer-backdrop" hidden></div>
  <nav id="tab-drawer" class="tab-drawer" aria-label="メニュー" hidden>
    <div class="drawer-head">
      <span class="drawer-title">メニュー</span>
      <button id="drawer-close" class="icon-button" type="button" aria-label="メニューを閉じる">×</button>
    </div>
    <a class="menu-item" href="${escapeHtml(homePath(args.day, args.today))}"${current("home")}>${icon("home")}<span>メイン</span></a>
    <a class="menu-item" href="/bookmarks"${current("bookmarks")}>${icon("bookmark")}<span>ブックマーク</span></a>
${pendingItem("history", "履歴")}
    <button id="genre-toggle" class="menu-item genre-toggle" type="button" aria-expanded="true" aria-controls="tab-groups">${icon("genre")}<span class="menu-label">ジャンル</span><span class="menu-chevron" aria-hidden="true">›</span></button>
    <div id="tab-groups" class="tab-groups">
${renderTabGroups(args)}
    </div>
    <div class="menu-footer">
      <a class="menu-item" href="/glossary"${current("glossary")}>${icon("glossary")}<span>用語辞書</span></a>
      <a class="menu-item" href="/settings">${icon("settings")}<span>設定</span></a>
    </div>
  </nav>`;
}

/** まだ作っていない画面は、押せない項目として「準備中」を添えて出す。 */
function pendingItem(name: "history", label: string): string {
  return `    <span class="menu-item is-pending" aria-disabled="true">${icon(name)}<span class="menu-label">${label}</span><span class="menu-badge">準備中</span></span>`;
}

function renderTabGroups(args: { tabs: TabInfo[]; page: MenuPage; day: string; today: string }): string {
  return TAB_GROUP_ORDER.map((group) => {
    const members = args.tabs.filter((tab) => tab.group === group);
    if (members.length === 0) {
      return "";
    }
    const items = members
      .map(
        (tab) =>
          `        <a class="tab-item" href="${escapeHtml(readPath(tab.appName, args.day, args.today))}" data-app-name="${escapeHtml(tab.appName)}"${args.page === "read" && tab.isActive ? ' aria-current="page"' : ""}>
          <span class="tab-name">${escapeHtml(tab.label)}</span>
${tab.articleCount >= 0 ? `          <span class="tab-count">${tab.articleCount} 件</span>` : ""}
        </a>`,
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
