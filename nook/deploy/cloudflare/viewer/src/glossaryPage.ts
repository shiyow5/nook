// 用語辞書の画面(#17)。一覧・並べ替え・索引・表示の切り替えは /static/glossary.js が受け持つ。
import { displayLabel, type TabInfo, tabMeta } from "./content";
import type { GlossaryTerm } from "./glossary";
import { termToState } from "./glossary";
import { ICON_URL, icon } from "./icons";
import { renderMenu } from "./menu";
import { serializeStateForScript } from "./page";

export const GLOSSARY_SHELL = { scripts: ["menu.js", "glossary.js"], bodyAttributes: 'class="glossary-page"' };

export function renderGlossaryBody(args: { terms: GlossaryTerm[]; appNames: string[]; today: string }): string {
  const tabs: TabInfo[] = args.appNames.map((appName) => ({
    appName,
    label: displayLabel(appName),
    ...tabMeta(appName),
    articleCount: -1,
    isActive: false,
  }));
  const state = {
    today: args.today,
    terms: args.terms.map(termToState),
    tab_labels: Object.fromEntries(args.appNames.map((appName) => [appName, displayLabel(appName)])),
  };
  return `  <header class="topbar">
    <button id="menu-button" class="icon-button" type="button" aria-label="メニューを開く" aria-expanded="false" aria-controls="tab-drawer">${icon("menu")}</button>
    <a class="brand" href="/">
      <img src="${ICON_URL}/svg?seed=nook" alt="" width="26" height="26">
      <span class="brand-name">nook</span>
      <span class="brand-sep" aria-hidden="true">/</span>
      <span class="brand-tab">用語辞書</span>
    </a>
    <a id="settings-link" class="icon-button" href="/settings" aria-label="設定" title="設定">${icon("settings")}</a>
  </header>
  <main class="glossary-main">
    <div class="glossary-head">
      <h1 class="page-title">用語辞書</h1>
      <div class="glossary-progress" role="group" aria-label="習得の進み具合">
        <span id="progress-text" class="glossary-progress-text"></span>
        <span class="progress-track" aria-hidden="true"><span id="progress-bar" class="progress-bar"></span></span>
      </div>
    </div>

    <details id="term-form-box" class="term-form-box">
      <summary>用語を追加する</summary>
      <form id="term-form" class="term-form">
        <label>用語<input id="term-word" name="word" required maxlength="80" autocomplete="off"></label>
        <label>読み(ひらがな、任意)<input id="term-reading" name="reading" maxlength="80" autocomplete="off"></label>
        <label class="term-form-wide">説明<textarea id="term-explanation" name="explanation" required maxlength="1000" rows="3"></textarea></label>
        <label class="term-form-wide">メモ(任意)<textarea id="term-note" name="note" maxlength="2000" rows="2"></textarea></label>
        <label class="term-check"><input id="term-important" name="important" type="checkbox"> 重要</label>
        <div class="term-form-actions">
          <button id="term-draft" class="text-button" type="button">AI に説明を下書きしてもらう</button>
          <button class="primary-button" type="submit">追加</button>
        </div>
        <p id="term-form-status" class="status-message" role="status" aria-live="polite"></p>
      </form>
    </details>

    <div class="glossary-controls">
      <label class="filter-field">
        ${icon("search", 16)}
        <span class="visually-hidden">用語を検索</span>
        <input id="glossary-search" type="search" placeholder="用語や説明を検索" autocomplete="off">
      </label>
      <label class="glossary-select">並べ替え
        <select id="glossary-sort">
          <option value="new">新しい順</option>
          <option value="name">名前順</option>
          <option value="important">重要度順</option>
          <option value="learning">未理解を先に</option>
        </select>
      </label>
      <div class="segmented" role="group" aria-label="表示の形">
        <button id="view-list" type="button" aria-pressed="true">リスト</button>
        <button id="view-cards" type="button" aria-pressed="false">単語カード</button>
      </div>
    </div>
    <div id="glossary-index" class="glossary-index" role="group" aria-label="頭文字で絞り込む"></div>

    <details id="important-box" class="important-box" open>
      <summary>重要な用語 <span id="important-count"></span></summary>
      <ul id="important-list" class="term-list-view"></ul>
    </details>

    <ul id="glossary-list" class="term-list-view" aria-live="polite"></ul>
    <p id="glossary-empty" class="empty-state" hidden></p>
  </main>

${renderMenu({ tabs, page: "glossary", day: args.today, today: args.today })}

  <script id="glossary-state" type="application/json">${serializeStateForScript(state)}</script>
</body>
</html>
`;
}
