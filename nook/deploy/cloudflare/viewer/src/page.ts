// Python 版 nook/services/viewer/templates/index.html を移植したもの(天気表示は除く)。
import type { InitialRender, ViewerPage } from "./content";
import { pageToState } from "./content";
import { escapeHtml } from "./render";

const ICON_URL = "https://api.dicebear.com/7.x/shapes";

export function renderIndexHtml(page: ViewerPage, initial: InitialRender, assetVersion: string): string {
  const version = encodeURIComponent(assetVersion);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nook</title>
  <link rel="icon" type="image/svg+xml" href="${ICON_URL}/svg?seed=nook">
  <link rel="apple-touch-icon" href="${ICON_URL}/png?seed=nook&amp;size=180">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/katex.min.css">
  <link rel="stylesheet" href="/static/viewer.css?v=${version}">
  <script defer src="https://cdn.jsdelivr.net/npm/marked@18.2.0/marked.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js"></script>
  <script defer src="/static/viewer.js?v=${version}"></script>
</head>
<body>
  <button id="scrollTopBtn" type="button" title="Go to top" aria-label="Scroll to top">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M8 12a.5.5 0 0 0 .5-.5V5.707l2.146 2.147a.5.5 0 0 0 .708-.708l-3-3a.5.5 0 0 0-.708 0l-3 3a.5.5 0 1 0 .708.708L7.5 5.707V11.5a.5.5 0 0 0 .5.5"/>
    </svg>
  </button>

  <div class="toast-container position-fixed bottom-0 end-0 p-3">
    <div id="liveToast" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="toast-header">
        <img src="${ICON_URL}/svg?seed=nook" class="rounded me-2" alt="nook icon" width="20" height="20">
        <strong class="me-auto">my-nook</strong>
        <small>Just now</small>
        <button type="button" class="btn-close" aria-label="Close"></button>
      </div>
      <div class="toast-body"></div>
    </div>
  </div>

  <nav class="navbar">
    <div class="container">
      <a class="navbar-brand" href="/">
        <img src="${ICON_URL}/svg?seed=nook" alt="nook">
        my-nook
      </a>
      <div class="ambient-info">
        <span id="clock">--:--</span>
      </div>
    </div>
  </nav>

  <div class="container main-content">
    <div class="row">
      <div class="col-md-3">
        <div class="sidebar-sticky">
          <div class="content-container">
            <form id="date-form" action="/" method="get">
              <div class="mb-3">
                <label for="date" class="form-label">Date</label>
                <input id="date" name="date" class="form-control" type="text" value="${escapeHtml(page.date)}" placeholder="YYYY-MM-DD">
              </div>
              <button type="submit" class="btn btn-primary w-100">Load</button>
            </form>

            <div class="toc">
              <h5>Contents</h5>
              <ul id="toc-list" class="toc-list">
${renderToc(initial)}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div class="col-md-9">
        <div class="content-container">
          <ul class="nav nav-tabs" id="app-nav" role="tablist">
${renderTabs(initial)}
          </ul>

          <div class="content-toolbar">
            <div class="toolbar-actions">
              <p id="status-message" class="status-message"></p>
              <button id="retry-button" type="button" class="btn btn-primary btn-sm">Retry Now</button>
            </div>
          </div>

          <div id="missing-alert" class="alert alert-warning${initial.missingMessage ? "" : " d-none"}" role="alert">${escapeHtml(initial.missingMessage ?? "")}</div>
          <div id="article-content" class="article-list">
${renderArticles(initial)}
          </div>
        </div>
      </div>
    </div>
  </div>

  <script id="viewer-state" type="application/json">${serializeStateForScript(pageToState(page))}</script>
</body>
</html>
`;
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

function renderToc(initial: InitialRender): string {
  if (initial.headings.length === 0) {
    return '                <li class="toc-item"><span class="empty-state">No headings</span></li>';
  }
  return initial.headings
    .map(
      (heading, index) =>
        `                <li class="toc-item"><a class="toc-link${index === 0 ? " active" : ""}" href="#${escapeHtml(heading.anchor)}" data-level="${heading.level}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join("\n");
}

function renderTabs(initial: InitialRender): string {
  return initial.tabs
    .map(
      (tab) =>
        `            <li class="nav-item" role="presentation"><button type="button" role="tab" class="nav-link${tab.isActive ? " active" : ""}" data-app-name="${escapeHtml(tab.appName)}">${escapeHtml(tab.label)}</button></li>`,
    )
    .join("\n");
}

function renderArticles(initial: InitialRender): string {
  if (initial.articles.length === 0) {
    return initial.missingMessage ? '            <p class="empty-state">Content for this date is not available.</p>' : "";
  }
  return initial.articles
    .map((article) => {
      const id = escapeHtml(article.articleId);
      return `            <section class="article-section" data-article-id="${id}">
              <div class="article-body markdown-content">${article.html}</div>
              <div class="chat-container article-chat-container">
                <div class="chat-log article-chat-log" data-article-id="${id}"></div>
                <form class="chat-input article-chat-form" data-article-id="${id}">
                  <textarea class="form-control article-chat-input" data-article-id="${id}" placeholder="Ask a question about this article..."></textarea>
                  <button type="submit" class="btn btn-primary article-chat-submit">Ask</button>
                </form>
              </div>
            </section>`;
    })
    .join("\n");
}
