// 設定画面(#7)。中身は /static/settings.js が #settings-state を元に組み立てる。
import { COLLECTOR_NAMES, displayLabel, tabMeta } from "./content";
import { serializeStateForScript } from "./page";
import { RSS_SERVICES } from "./settings";
import { ICON_URL, icon, iconButtonAttributes, iconSprite } from "./icons";


export function renderSettingsHtml(
  state: { defaults: unknown; settings: unknown },
  viewerServices: string[],
  assetVersion: string,
): string {
  const version = encodeURIComponent(assetVersion);
  const names = [...new Set([...viewerServices, ...COLLECTOR_NAMES])];
  const payload = {
    defaults: state.defaults,
    settings: state.settings,
    rss_services: RSS_SERVICES,
    tab_meta: Object.fromEntries(names.map((name) => [name, { label: displayLabel(name), ...tabMeta(name) }])),
  };
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>設定 - nook</title>
  <link rel="icon" type="image/svg+xml" href="${ICON_URL}/svg?seed=nook">
  <link rel="stylesheet" href="/static/app.css?v=${version}">
  <script defer src="/static/settings.js?v=${version}"></script>
</head>
<body class="settings-page">
  ${iconSprite()}
  <header class="topbar">
    <a class="icon-button" href="/" ${iconButtonAttributes("ホームへ戻る")}>${icon("chevronLeft")}</a>
    <a class="brand" href="/">
      <img src="${ICON_URL}/svg?seed=nook" alt="" width="26" height="26">
      <span class="brand-name">nook</span>
      <span class="brand-sep" aria-hidden="true">/</span>
      <span class="brand-tab">設定</span>
    </a>
  </header>
  <main class="settings-main">
    <section class="settings-card" aria-labelledby="collectors-title">
      <h2 id="collectors-title">収集対象</h2>
      <p class="settings-note">毎朝 6:17 の収集で動かすタブを選びます。止めたタブも、記事一覧の「再取得」からは動かせます。</p>
      <div id="collector-list" class="collector-list"></div>
    </section>
    <section class="settings-card" aria-labelledby="feeds-title">
      <div class="settings-card-head">
        <div>
          <h2 id="feeds-title">フィードとキーワード</h2>
          <p class="settings-note">キーワードを入れたフィードは、タイトルか本文に一致した記事だけを要約します。空なら全部の記事が対象です。</p>
        </div>
        <label class="settings-field">タブ
          <select id="rss-service"></select>
        </label>
      </div>
      <div class="settings-row">
        <label class="settings-field">1 フィードあたりの上限
          <input id="rss-limit" type="number" min="1" max="50" step="1" inputmode="numeric">
        </label>
        <button id="rss-reset" class="text-button" type="button">このタブを初期値に戻す</button>
      </div>
      <div id="feed-list" class="feed-list"></div>
      <form id="feed-add" class="feed-add">
        <label class="settings-field">表示名
          <input id="feed-add-name" type="text" maxlength="80" placeholder="例: Zenn 強化学習" required>
        </label>
        <label class="settings-field settings-field-wide">RSS の URL
          <input id="feed-add-url" type="url" maxlength="500" placeholder="https://zenn.dev/topics/.../feed" required>
        </label>
        <button class="primary-button" type="submit">フィードを追加</button>
      </form>
    </section>
    <p id="settings-empty" class="empty-state" hidden>まだ設定の初期値がありません。次の収集(毎朝 6:17、または手動の収集)が終わると編集できるようになります。</p>
  </main>
  <div id="save-bar" class="save-bar" hidden>
    <span id="save-message" role="status" aria-live="polite"></span>
    <div class="save-actions">
      <button id="save-cancel" class="text-button" type="button">取り消す</button>
      <button id="save-submit" class="accent-solid-button" type="button">保存する</button>
    </div>
  </div>
  <script id="settings-state" type="application/json">${serializeStateForScript(payload)}</script>
</body>
</html>
`;
}
