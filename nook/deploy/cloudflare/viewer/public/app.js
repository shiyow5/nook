// 読む画面(Design キャンバスの A+B 案)の動き。サーバーが埋め込んだ #viewer-state を起点に描画する。
"use strict";

const STORAGE_KEYS = { listOpen: "nook.listOpen", studyOpen: "nook.studyOpen" };
const POLL_INTERVAL_MS = 5000;
const POLL_ATTEMPTS = 24;

function shiftDay(day, delta) {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + delta));
  return shifted.toISOString().slice(0, 10);
}

function buildMarkdownRequestPath(appName, currentDate, previousUpdatedAt = null) {
  const query = new URLSearchParams({ date: currentDate });
  if (previousUpdatedAt) {
    query.set("previous_updated_at", previousUpdatedAt);
  }
  return `/api/markdown/${encodeURIComponent(appName)}?${query.toString()}`;
}

function buildChatRequestPayload(articleId, currentDate, chatHistory, message) {
  return { article_id: articleId, date: currentDate, chat_history: chatHistory, message };
}

function filterArticles(articles, query) {
  const needle = query.trim().toLowerCase();
  const indexed = articles.map((article, index) => ({ article, index }));
  if (!needle) {
    return indexed;
  }
  return indexed.filter(({ article }) =>
    `${article.title} ${article.source || ""}`.toLowerCase().includes(needle),
  );
}

function readStoredFlag(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function storeFlag(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // 保存できない環境(プライベートブラウズなど)では、開閉状態を覚えないだけにする
  }
}

/** 本文中の「View on …」だけの段落は、上の「元の記事を開く」と重なるので消す。 */
function removeViewLinkParagraph(body) {
  body.querySelectorAll("p").forEach((paragraph) => {
    const links = paragraph.querySelectorAll("a");
    if (links.length === 1 && paragraph.textContent.trim() === links[0].textContent.trim() && /^View\b/.test(links[0].textContent.trim())) {
      paragraph.remove();
    }
  });
}

function cloneArticle(article) {
  return {
    article_id: article.article_id,
    title: article.title,
    html: article.html || "",
    source: article.source || null,
    link: article.link || null,
  };
}

function startViewer() {
  const stateNode = document.getElementById("viewer-state");
  if (!stateNode) {
    return;
  }
  const initial = JSON.parse(stateNode.textContent);

  const runtime = {
    date: initial.date,
    today: initial.today,
    appNames: initial.app_names,
    tabMeta: initial.tab_meta || {},
    groupOrder: initial.tab_group_order || [],
    currentApp: initial.current_app || initial.app_names[0] || null,
    articles: Object.fromEntries(
      initial.app_names.map((name) => [name, (initial.articles[name] || []).map(cloneArticle)]),
    ),
    markdownExists: { ...initial.markdown_exists },
    markdownUpdatedAt: { ...initial.markdown_updated_at },
    selected: {},
    filter: "",
    listOpen: readStoredFlag(STORAGE_KEYS.listOpen, true),
    studyOpen: readStoredFlag(STORAGE_KEYS.studyOpen, false),
    chats: {},
    pendingChats: new Set(),
    pollTimerId: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    menuButton: $("menu-button"),
    drawer: $("tab-drawer"),
    drawerBackdrop: $("drawer-backdrop"),
    drawerClose: $("drawer-close"),
    tabGroups: $("tab-groups"),
    currentTabLabel: $("current-tab-label"),
    dateForm: $("date-form"),
    dateInput: $("date"),
    tabField: $("tab-field"),
    prevDay: $("prev-day"),
    nextDay: $("next-day"),
    todayButton: $("today-button"),
    filterInput: $("filter-input"),
    listPanel: $("list-panel"),
    listTabLabel: $("list-tab-label"),
    listCount: $("list-count"),
    listClose: $("list-close"),
    listRail: $("list-rail"),
    listOpen: $("list-open"),
    railPosition: $("rail-position"),
    articleList: $("article-list"),
    listEmpty: $("list-empty"),
    retryButton: $("retry-button"),
    status: $("status-message"),
    reader: $("reader"),
    studyPanel: $("study-panel"),
    studyClose: $("study-close"),
    studyArticle: $("study-article"),
    studyFab: $("study-fab"),
    chatLog: $("chat-log"),
    chatForm: $("chat-form"),
    chatInput: $("chat-input"),
    chatSubmit: $("chat-submit"),
  };

  function label(appName) {
    return runtime.tabMeta[appName]?.label || appName;
  }

  function articlesOf(appName = runtime.currentApp) {
    return appName ? runtime.articles[appName] || [] : [];
  }

  function selectedIndex() {
    const articles = articlesOf();
    const index = runtime.selected[runtime.currentApp] || 0;
    return Math.min(index, Math.max(articles.length - 1, 0));
  }

  function currentArticle() {
    return articlesOf()[selectedIndex()] || null;
  }

  function chatKey(article) {
    return `${runtime.currentApp}:${article.article_id}`;
  }

  function setStatus(message) {
    el.status.textContent = message;
  }

  function renderMarkdown(markdown) {
    const container = document.createElement("div");
    container.className = "markdown-content";
    if (window.marked && window.DOMPurify) {
      container.innerHTML = window.DOMPurify.sanitize(window.marked.parse(markdown || "", { breaks: true, gfm: true }));
    } else {
      container.textContent = markdown;
    }
    return container;
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("date", runtime.date);
    if (runtime.currentApp) {
      url.searchParams.set("tab", runtime.currentApp);
    }
    window.history.replaceState(null, "", url);
    el.tabField.value = runtime.currentApp || "";
  }

  function goToDay(day) {
    const url = new URL(window.location.href);
    url.search = "";
    if (day && day !== runtime.today) {
      url.searchParams.set("date", day);
    }
    if (runtime.currentApp) {
      url.searchParams.set("tab", runtime.currentApp);
    }
    window.location.href = url.toString();
  }

  function renderTabs() {
    el.currentTabLabel.textContent = label(runtime.currentApp);
    el.listTabLabel.textContent = label(runtime.currentApp);
    el.tabGroups.replaceChildren(
      ...runtime.groupOrder
        .map((group) => {
          const members = runtime.appNames.filter((name) => runtime.tabMeta[name]?.group === group);
          if (members.length === 0) {
            return null;
          }
          const wrapper = document.createElement("div");
          wrapper.className = "tab-group";
          const heading = document.createElement("span");
          heading.className = "tab-group-name";
          heading.textContent = group;
          wrapper.append(heading, ...members.map(renderTabItem));
          return wrapper;
        })
        .filter(Boolean),
    );
  }

  function renderTabItem(appName) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab-item";
    button.dataset.appName = appName;
    if (appName === runtime.currentApp) {
      button.setAttribute("aria-current", "page");
    }
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = label(appName);
    const description = document.createElement("span");
    description.className = "tab-desc";
    description.textContent = runtime.tabMeta[appName]?.description || "";
    const count = document.createElement("span");
    count.className = "tab-count";
    count.textContent = `${articlesOf(appName).length} 件`;
    button.append(name, description, count);
    button.addEventListener("click", () => {
      selectApp(appName);
      closeDrawer();
    });
    return button;
  }

  function renderList() {
    const articles = articlesOf();
    const visible = filterArticles(articles, runtime.filter);
    const current = selectedIndex();
    el.listCount.textContent = runtime.filter ? `${visible.length} / ${articles.length} 件` : `${articles.length} 件`;
    el.articleList.replaceChildren(
      ...visible.map(({ article, index }) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "article-row";
        button.dataset.index = String(index);
        if (index === current) {
          button.setAttribute("aria-current", "true");
        }
        const source = document.createElement("span");
        source.className = "row-source";
        source.textContent = article.source || "";
        const title = document.createElement("span");
        title.className = "row-title";
        title.textContent = article.title;
        button.append(source, title);
        button.addEventListener("click", () => selectArticle(index));
        item.append(button);
        return item;
      }),
    );
    const empty = articles.length === 0 || visible.length === 0;
    el.listEmpty.hidden = !empty;
    if (articles.length === 0) {
      el.listEmpty.textContent = `${runtime.date} の ${label(runtime.currentApp)} はまだありません。`;
    } else if (visible.length === 0) {
      el.listEmpty.textContent = "絞り込みに一致する記事がありません。";
    }
    el.listPanel.hidden = !runtime.listOpen;
    el.listRail.hidden = runtime.listOpen;
    el.listClose.setAttribute("aria-expanded", "true");
    el.listOpen.setAttribute("aria-expanded", "false");
    el.railPosition.textContent = articles.length ? `${current + 1} / ${articles.length}` : "";
  }

  function renderReader() {
    const articles = articlesOf();
    const article = currentArticle();
    if (!article) {
      const empty = document.createElement("div");
      empty.className = "empty-state reader-empty";
      empty.textContent = "表示できる記事がありません。日付やタブを変えてみてください。";
      el.reader.replaceChildren(empty);
      return;
    }
    const index = selectedIndex();
    const view = document.createElement("article");
    view.className = "article-view";
    view.dataset.articleId = article.article_id;

    const meta = document.createElement("div");
    meta.className = "article-meta";
    const chip = document.createElement("span");
    chip.className = "source-chip";
    chip.textContent = article.source || "";
    const position = document.createElement("span");
    position.textContent = `${index + 1} / ${articles.length}`;
    meta.append(chip, position);

    const actions = document.createElement("div");
    actions.className = "article-actions";
    if (article.link) {
      const link = document.createElement("a");
      link.className = "text-button";
      link.href = article.link;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "元の記事を開く ↗";
      actions.append(link);
    }
    const study = document.createElement("button");
    study.type = "button";
    study.className = "accent-button";
    study.textContent = "この記事で学ぶ";
    study.addEventListener("click", () => setStudyOpen(true));
    actions.append(study);

    const body = document.createElement("div");
    body.className = "article-body markdown-content";
    // html はサーバー側(render.ts)で許可したタグと URL だけに絞ったもの
    body.innerHTML = article.html;
    removeViewLinkParagraph(body);

    const pager = document.createElement("div");
    pager.className = "article-pager";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "text-button";
    prev.textContent = "‹ 前の記事";
    prev.disabled = index === 0;
    prev.addEventListener("click", () => selectArticle(index - 1));
    const next = document.createElement("button");
    next.type = "button";
    next.className = "primary-button";
    next.textContent = "次の記事 ›";
    next.disabled = index >= articles.length - 1;
    next.addEventListener("click", () => selectArticle(index + 1));
    pager.append(prev, next);

    view.append(meta, actions, body, pager);
    el.reader.replaceChildren(view);
  }

  function renderStudy() {
    el.studyPanel.hidden = !runtime.studyOpen;
    el.studyFab.hidden = runtime.studyOpen;
    el.studyFab.setAttribute("aria-expanded", String(runtime.studyOpen));
    const article = currentArticle();
    el.studyArticle.textContent = article ? `対象: ${article.title}` : "記事を選ぶと、その記事について質問できます。";
    const pending = article ? runtime.pendingChats.has(chatKey(article)) : false;
    el.chatInput.disabled = !article || pending;
    el.chatSubmit.disabled = !article || pending;
    el.chatSubmit.textContent = pending ? "回答を待っています…" : "送信";
    el.studyPanel.querySelectorAll(".chip").forEach((chip) => {
      chip.disabled = !article || pending;
    });
    const messages = article ? runtime.chats[chatKey(article)] || [] : [];
    el.chatLog.replaceChildren(
      ...messages.map((message) => {
        if (message.role === "assistant") {
          const node = renderMarkdown(message.content);
          node.classList.add("chat-message", "assistant");
          return node;
        }
        const node = document.createElement("div");
        node.className = "chat-message user";
        node.textContent = message.content;
        return node;
      }),
    );
    if (pending) {
      const waiting = document.createElement("div");
      waiting.className = "chat-message assistant pending";
      waiting.textContent = "調べています…";
      el.chatLog.append(waiting);
    }
  }

  function render() {
    renderTabs();
    renderList();
    renderReader();
    renderStudy();
    syncUrl();
  }

  function selectApp(appName) {
    if (!runtime.appNames.includes(appName)) {
      return;
    }
    runtime.currentApp = appName;
    runtime.filter = "";
    el.filterInput.value = "";
    setStatus("");
    render();
    window.scrollTo({ top: 0 });
  }

  function selectArticle(index) {
    const articles = articlesOf();
    if (index < 0 || index >= articles.length) {
      return;
    }
    runtime.selected[runtime.currentApp] = index;
    renderList();
    renderReader();
    renderStudy();
    window.scrollTo({ top: 0 });
    const row = el.articleList.querySelector(`[data-index="${index}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }

  function setListOpen(open) {
    runtime.listOpen = open;
    storeFlag(STORAGE_KEYS.listOpen, open);
    renderList();
    (open ? el.listClose : el.listOpen).focus();
  }

  function setStudyOpen(open) {
    runtime.studyOpen = open;
    storeFlag(STORAGE_KEYS.studyOpen, open);
    renderStudy();
    (open ? el.chatInput : el.studyFab).focus();
  }

  function openDrawer() {
    el.drawer.hidden = false;
    el.drawerBackdrop.hidden = false;
    el.menuButton.setAttribute("aria-expanded", "true");
    (el.drawer.querySelector('[aria-current="page"]') || el.drawerClose).focus();
  }

  function closeDrawer() {
    if (el.drawer.hidden) {
      return;
    }
    el.drawer.hidden = true;
    el.drawerBackdrop.hidden = true;
    el.menuButton.setAttribute("aria-expanded", "false");
    el.menuButton.focus();
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function loadMarkdown(appName, previousUpdatedAt) {
    const response = await fetch(buildMarkdownRequestPath(appName, runtime.date, previousUpdatedAt));
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`記事の読み込みに失敗しました(${response.status})`);
    }
    const payload = await response.json();
    runtime.articles[appName] = (payload.articles || []).map(cloneArticle);
    runtime.markdownExists[appName] = runtime.articles[appName].length > 0;
    runtime.markdownUpdatedAt[appName] = payload.updated_at || null;
    return runtime.articles[appName].length > 0;
  }

  function stopPolling() {
    if (runtime.pollTimerId !== null) {
      window.clearInterval(runtime.pollTimerId);
      runtime.pollTimerId = null;
    }
  }

  function startPolling(appName) {
    stopPolling();
    let remaining = POLL_ATTEMPTS;
    const previousUpdatedAt = runtime.markdownUpdatedAt[appName] || null;
    runtime.pollTimerId = window.setInterval(async () => {
      remaining -= 1;
      try {
        if (await loadMarkdown(appName, previousUpdatedAt)) {
          stopPolling();
          setStatus(`${label(appName)} を更新しました。`);
          render();
        } else if (remaining <= 0) {
          stopPolling();
          setStatus("再取得を受け付けました。反映まで数分かかることがあります。");
        }
      } catch (error) {
        stopPolling();
        setStatus(error instanceof Error ? error.message : "更新の確認に失敗しました。");
      }
    }, POLL_INTERVAL_MS);
  }

  async function retryCurrentApp() {
    const appName = runtime.currentApp;
    if (!appName) {
      return;
    }
    el.retryButton.disabled = true;
    setStatus(`${label(appName)} の再取得を依頼しています…`);
    try {
      const response = await fetch(`/retry/${encodeURIComponent(appName)}`, { method: "POST" });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload.detail || "再取得に失敗しました。");
      }
      setStatus("再取得を始めました。終わると自動で表示が変わります。");
      startPolling(appName);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "再取得に失敗しました。");
    } finally {
      window.setTimeout(() => {
        el.retryButton.disabled = false;
      }, 1000);
    }
  }

  function serializeHistory(messages) {
    if (messages.length === 0) {
      return "なし";
    }
    return messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
  }

  async function ask(message) {
    const article = currentArticle();
    const text = message.trim();
    if (!article || !text) {
      return;
    }
    const key = chatKey(article);
    if (runtime.pendingChats.has(key)) {
      return;
    }
    const appName = runtime.currentApp;
    const history = runtime.chats[key] || [];
    const priorHistory = serializeHistory(history);
    runtime.chats[key] = [...history, { role: "user", content: text }];
    runtime.pendingChats.add(key);
    el.chatInput.value = "";
    renderStudy();
    try {
      const response = await fetch(`/chat/${encodeURIComponent(appName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildChatRequestPayload(article.article_id, runtime.date, priorHistory, text)),
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload.detail || "回答を取得できませんでした。");
      }
      runtime.chats[key] = [...runtime.chats[key], { role: "assistant", content: payload.response || "回答が空でした。" }];
    } catch (error) {
      const reason = error instanceof Error ? error.message : "回答を取得できませんでした。";
      runtime.chats[key] = [...runtime.chats[key], { role: "assistant", content: `エラー: ${reason}` }];
    } finally {
      runtime.pendingChats.delete(key);
      renderStudy();
    }
  }

  function isTyping(target) {
    return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  }

  el.menuButton.addEventListener("click", openDrawer);
  el.drawerClose.addEventListener("click", closeDrawer);
  el.drawerBackdrop.addEventListener("click", closeDrawer);
  el.listClose.addEventListener("click", () => setListOpen(false));
  el.listOpen.addEventListener("click", () => setListOpen(true));
  el.studyFab.addEventListener("click", () => setStudyOpen(true));
  el.studyClose.addEventListener("click", () => setStudyOpen(false));
  el.retryButton.addEventListener("click", retryCurrentApp);
  el.filterInput.addEventListener("input", () => {
    runtime.filter = el.filterInput.value;
    renderList();
  });
  el.dateInput.addEventListener("click", () => {
    try {
      el.dateInput.showPicker();
    } catch {
      // showPicker が無いブラウザでは、入力欄そのものの動きに任せる
    }
  });
  el.dateInput.addEventListener("change", () => {
    if (el.dateInput.value) {
      goToDay(el.dateInput.value);
    }
  });
  el.dateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    goToDay(el.dateInput.value);
  });
  el.prevDay.addEventListener("click", () => goToDay(shiftDay(runtime.date, -1)));
  el.nextDay.addEventListener("click", () => goToDay(shiftDay(runtime.date, 1)));
  el.todayButton.addEventListener("click", () => goToDay(runtime.today));
  el.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    ask(el.chatInput.value);
  });
  el.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask(el.chatInput.value);
    }
  });
  el.studyPanel.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => ask(chip.dataset.prompt || chip.textContent || ""));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDrawer();
      return;
    }
    if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.key === "j") {
      selectArticle(selectedIndex() + 1);
    } else if (event.key === "k") {
      selectArticle(selectedIndex() - 1);
    }
  });

  render();
}

if (typeof window !== "undefined") {
  window.__nookViewerTestHooks = { shiftDay, buildMarkdownRequestPath, buildChatRequestPayload, filterArticles };
  document.addEventListener("DOMContentLoaded", startViewer);
}
