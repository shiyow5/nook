// 読む画面(Design キャンバスの A+B 案)の動き。サーバーが埋め込んだ #viewer-state を起点に描画する。
"use strict";

const STORAGE_KEYS = { listOpen: "nook.listOpen", studyOpen: "nook.studyOpen", chatOpen: "nook.chatOpen" };
const POLL_INTERVAL_MS = 5000;
const POLL_ATTEMPTS = 24;
// これより狭い画面では、一覧と本文を切り替えて 1 つずつ見せる(app.css の @media と同じ値)
const NARROW_QUERY = "(max-width: 760px)";
// シートを下に引いたとき、元の高さのこの割合より低くなったら閉じる
const SHEET_CLOSE_RATIO = 0.6;
// 上に引いてこの高さ(画面に対する割合)を超えたら全画面に広げる
const SHEET_FULL_RATIO = 0.75;
const INTRO_PROMPT =
  "この記事を、この分野に詳しくない人向けの入門の解説として説明してください。背景、何が問題で、記事が何をしたのか、なぜ大事なのかの順に、専門用語には短い説明を添えてください。";

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
    chatOpen: readStoredFlag(STORAGE_KEYS.chatOpen, false) && !readStoredFlag(STORAGE_KEYS.studyOpen, false),
    chats: {},
    pendingChats: new Set(),
    pollTimerId: null,
    view: "list",
    // 記事ごとの用語と問題(app:article_id → { terms, quiz })。状態は idle / loading / ready / error
    study: {},
  };
  const narrow = window.matchMedia(NARROW_QUERY);

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
    studyBackdrop: $("study-backdrop"),
    chatPanel: $("chat-panel"),
    chatFab: $("chat-fab"),
    chatClose: $("chat-close"),
    chatArticle: $("chat-article"),
    chatLog: $("chat-log"),
    chatForm: $("chat-form"),
    chatInput: $("chat-input"),
    chatSubmit: $("chat-submit"),
    termList: $("term-list"),
    quizButton: $("quiz-button"),
    quizArea: $("quiz-area"),
    introButton: $("intro-button"),
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

  function renderAnswer(message) {
    const container = document.createElement("div");
    container.className = "markdown-content";
    if (message.html) {
      // html はサーバー側(render.ts)で記事本文と同じ許可リストに絞ったもの
      container.innerHTML = message.html;
    } else {
      container.style.whiteSpace = "pre-wrap";
      container.textContent = message.content;
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
    const back = document.createElement("button");
    back.type = "button";
    back.className = "text-button back-button";
    back.textContent = "‹ 一覧";
    back.addEventListener("click", () => setView("list"));
    meta.append(back);
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

  function studyEntry(article) {
    const key = chatKey(article);
    if (!runtime.study[key]) {
      runtime.study[key] = {
        terms: { status: "idle", items: [], error: "" },
        quiz: { status: "idle", items: [], error: "", answers: {} },
      };
    }
    return runtime.study[key];
  }

  async function loadStudy(kind) {
    const article = currentArticle();
    if (!article) {
      return;
    }
    const entry = studyEntry(article)[kind];
    if (entry.status === "loading" || entry.status === "ready") {
      return;
    }
    entry.status = "loading";
    entry.error = "";
    renderStudy();
    try {
      const response = await fetch(`/api/study/${encodeURIComponent(runtime.currentApp)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article_id: article.article_id, date: runtime.date, kind }),
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        throw new Error(payload.detail || `作成できませんでした(${response.status})`);
      }
      entry.items = kind === "terms" ? payload.terms || [] : payload.questions || [];
      entry.status = "ready";
    } catch (error) {
      entry.status = "error";
      entry.error = error instanceof Error ? error.message : "作成できませんでした。";
    }
    renderStudy();
  }

  function studyMessage(className, textContent) {
    const node = document.createElement("p");
    node.className = className;
    node.textContent = textContent;
    return node;
  }

  function renderTerms(article) {
    if (!article) {
      el.termList.replaceChildren();
      return;
    }
    const terms = studyEntry(article).terms;
    if (terms.status === "loading" || terms.status === "idle") {
      el.termList.replaceChildren(studyMessage("study-loading", "記事から用語を選んでいます…"));
      return;
    }
    if (terms.status === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "text-button";
      retry.textContent = "もう一度試す";
      retry.addEventListener("click", () => {
        terms.status = "idle";
        loadStudy("terms");
      });
      el.termList.replaceChildren(studyMessage("study-error", terms.error), retry);
      return;
    }
    el.termList.replaceChildren(
      ...terms.items.map((term) => {
        const card = document.createElement("div");
        card.className = "term-card";
        const word = document.createElement("span");
        word.className = "term-word";
        word.textContent = term.word;
        const text = document.createElement("span");
        text.className = "term-text";
        text.textContent = term.explanation;
        card.append(word, text);
        return card;
      }),
    );
  }

  function renderQuiz(article) {
    const quiz = article ? studyEntry(article).quiz : null;
    el.quizButton.disabled = !quiz || quiz.status === "loading";
    el.quizButton.textContent = quiz?.status === "loading" ? "問題を作っています…" : "理解度チェック(3 問)";
    if (!quiz || quiz.status === "idle" || quiz.status === "loading") {
      el.quizArea.replaceChildren();
      return;
    }
    if (quiz.status === "error") {
      el.quizArea.replaceChildren(studyMessage("study-error", quiz.error));
      return;
    }
    const answered = Object.keys(quiz.answers).length;
    const correct = quiz.items.filter((item, index) => quiz.answers[index] === item.answer_index).length;
    const nodes = quiz.items.map((item, index) => {
      const box = document.createElement("div");
      box.className = "quiz-question";
      box.append(studyMessage("quiz-text", `Q${index + 1}. ${item.question}`));
      const choices = document.createElement("div");
      choices.className = "quiz-choices";
      const chosen = quiz.answers[index];
      item.choices.forEach((choice, choiceIndex) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "quiz-choice";
        button.textContent = choice;
        if (chosen !== undefined) {
          button.disabled = true;
          if (choiceIndex === item.answer_index) {
            button.classList.add("correct");
          } else if (choiceIndex === chosen) {
            button.classList.add("wrong");
          }
        }
        button.addEventListener("click", () => {
          quiz.answers = { ...quiz.answers, [index]: choiceIndex };
          renderStudy();
        });
        choices.append(button);
      });
      box.append(choices);
      if (chosen !== undefined) {
        const verdict = chosen === item.answer_index ? "正解です。" : "不正解です。";
        box.append(studyMessage("quiz-result", `${verdict}${item.explanation}`));
      }
      return box;
    });
    if (answered === quiz.items.length) {
      nodes.push(studyMessage("quiz-score", `${quiz.items.length} 問中 ${correct} 問正解でした。`));
    }
    el.quizArea.replaceChildren(...nodes);
  }

  /**
   * スマホのシートを上下に動かせるようにする。
   * つまみと見出しはそのまま掴んで動かす。中身の部分は、まず中身をスクロールし、
   * 上端(下へ引くとき)か下端(上へ引くとき)に着いてからさらに指を動かした分だけシートを動かす。
   */
  function enableSheetDrag(panel, close) {
    let drag = null;
    const maxHeight = () => window.innerHeight * 0.95;
    const heightAt = (y) => Math.max(0, Math.min(maxHeight(), drag.startHeight - (y - drag.startY)));
    const begin = (y) => {
      drag = { startY: y, startHeight: panel.getBoundingClientRect().height };
      panel.classList.add("dragging");
    };
    const move = (y) => {
      panel.style.height = `${heightAt(y)}px`;
    };
    const end = (y) => {
      const height = heightAt(y);
      const shouldClose = height < drag.startHeight * SHEET_CLOSE_RATIO;
      drag = null;
      panel.classList.remove("dragging");
      panel.style.height = "";
      if (shouldClose) {
        close();
        return;
      }
      panel.classList.toggle("sheet-full", height > window.innerHeight * SHEET_FULL_RATIO);
    };

    // つまみと見出し: マウスでも指でも、掴んだらすぐ動かす
    panel.querySelectorAll(".sheet-grip, .study-head").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        if (!narrow.matches || event.target.closest("button")) {
          return;
        }
        begin(event.clientY);
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          // キャプチャできなくても、つまみの上で動かす分には追従する
        }
      });
      handle.addEventListener("pointermove", (event) => {
        if (drag) {
          move(event.clientY);
        }
      });
      const finish = (event) => {
        if (drag) {
          end(event.clientY);
        }
      };
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });

    // 中身の部分: スクロールしきってから続けて引いた分だけシートを動かす
    let lastY = null;
    let touchDrag = false;
    panel.addEventListener(
      "touchstart",
      (event) => {
        const target = event.target;
        if (!narrow.matches || target.closest(".sheet-grip, .study-head, textarea, input")) {
          lastY = null;
          return;
        }
        lastY = event.touches[0].clientY;
        touchDrag = false;
      },
      { passive: true },
    );
    panel.addEventListener(
      "touchmove",
      (event) => {
        if (lastY === null) {
          return;
        }
        const y = event.touches[0].clientY;
        const delta = y - lastY;
        lastY = y;
        if (!touchDrag) {
          const atTop = panel.scrollTop <= 0;
          const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1;
          const canGrow = panel.getBoundingClientRect().height < maxHeight() - 1;
          if ((delta > 0 && atTop) || (delta < 0 && atBottom && canGrow)) {
            touchDrag = true;
            begin(y);
          } else {
            return;
          }
        }
        event.preventDefault();
        move(y);
      },
      { passive: false },
    );
    const finishTouch = (event) => {
      if (touchDrag && drag) {
        end(event.changedTouches[0]?.clientY ?? lastY);
      }
      touchDrag = false;
      lastY = null;
    };
    panel.addEventListener("touchend", finishTouch);
    panel.addEventListener("touchcancel", finishTouch);
  }

  function renderStudy() {
    const anyOpen = runtime.studyOpen || runtime.chatOpen;
    // シートを開いている間は裏の画面をスクロールさせない
    document.body.classList.toggle("sheet-open", anyOpen && narrow.matches);
    if (!runtime.studyOpen) {
      el.studyPanel.classList.remove("sheet-full");
    }
    if (!runtime.chatOpen) {
      el.chatPanel.classList.remove("sheet-full");
    }
    el.studyPanel.hidden = !runtime.studyOpen;
    el.chatPanel.hidden = !runtime.chatOpen;
    el.studyBackdrop.hidden = !anyOpen;
    el.studyFab.hidden = anyOpen;
    el.chatFab.hidden = anyOpen;
    el.studyFab.setAttribute("aria-expanded", String(runtime.studyOpen));
    el.chatFab.setAttribute("aria-expanded", String(runtime.chatOpen));
    const article = currentArticle();
    const target = article ? `対象: ${article.title}` : "記事を選ぶと、その記事について学べます。";
    el.studyArticle.textContent = target;
    el.chatArticle.textContent = target;
    renderTerms(article);
    renderQuiz(article);
    if (runtime.studyOpen && article && studyEntry(article).terms.status === "idle") {
      loadStudy("terms");
    }
    const pending = article ? runtime.pendingChats.has(chatKey(article)) : false;
    el.introButton.disabled = !article || pending;
    el.chatInput.disabled = !article || pending;
    el.chatSubmit.disabled = !article || pending;
    el.chatSubmit.textContent = pending ? "回答を待っています…" : "送信";
    el.chatPanel.querySelectorAll(".chip").forEach((chip) => {
      chip.disabled = !article || pending;
    });
    const messages = article ? runtime.chats[chatKey(article)] || [] : [];
    el.chatLog.replaceChildren(
      ...messages.map((message) => {
        if (message.role === "assistant") {
          const node = renderAnswer(message);
          node.classList.add("chat-message", "assistant");
          return node;
        }
        const node = document.createElement("div");
        node.className = "chat-message user";
        node.textContent = message.display || message.content;
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

  function setView(view) {
    runtime.view = view;
    document.body.dataset.view = view;
    if (view === "list") {
      const row = el.articleList.querySelector('[aria-current="true"]');
      row?.scrollIntoView({ block: "center" });
    } else {
      window.scrollTo({ top: 0 });
    }
  }

  function render() {
    document.body.dataset.view = runtime.view;
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
    runtime.view = "list";
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
    if (narrow.matches) {
      setView("read");
      return;
    }
    const row = el.articleList.querySelector(`[data-index="${index}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }

  function setListOpen(open) {
    runtime.listOpen = open;
    storeFlag(STORAGE_KEYS.listOpen, open);
    renderList();
    (open ? el.listClose : el.listOpen).focus();
  }

  // 学びパネルとチャットのパネルは同じ場所に出すので、片方を開くともう片方は閉じる
  function setPanels(studyOpen, chatOpen) {
    runtime.studyOpen = studyOpen;
    runtime.chatOpen = chatOpen;
    // スマホでは画面を覆うシートなので、次に開いたときに勝手に出ないよう覚えない
    if (!narrow.matches) {
      storeFlag(STORAGE_KEYS.studyOpen, studyOpen);
      storeFlag(STORAGE_KEYS.chatOpen, chatOpen);
    }
    renderStudy();
  }

  function setStudyOpen(open) {
    setPanels(open, false);
    (open ? el.studyClose : el.studyFab).focus();
  }

  function setChatOpen(open) {
    setPanels(false, open);
    (open ? el.chatInput : el.chatFab).focus();
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

  async function ask(message, displayText = null) {
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
    runtime.chats[key] = [...history, { role: "user", content: text, display: displayText }];
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
      runtime.chats[key] = [
        ...runtime.chats[key],
        { role: "assistant", content: payload.response || "回答が空でした。", html: payload.html || null },
      ];
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
  el.studyBackdrop.addEventListener("click", () => setPanels(false, false));
  el.chatFab.addEventListener("click", () => setChatOpen(true));
  enableSheetDrag(el.studyPanel, () => setStudyOpen(false));
  enableSheetDrag(el.chatPanel, () => setChatOpen(false));
  el.chatClose.addEventListener("click", () => setChatOpen(false));
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
  el.quizButton.addEventListener("click", () => loadStudy("quiz"));
  el.introButton.addEventListener("click", () => {
    setChatOpen(true);
    ask(INTRO_PROMPT, "入門の解説を読む");
  });
  el.chatPanel.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => ask(chip.dataset.prompt || chip.textContent || "", chip.textContent));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!el.drawer.hidden) {
        closeDrawer();
      } else if ((runtime.studyOpen || runtime.chatOpen) && narrow.matches) {
        setPanels(false, false);
      }
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

  if (narrow.matches) {
    runtime.studyOpen = false;
    runtime.chatOpen = false;
  }
  render();
}

if (typeof window !== "undefined") {
  window.__nookViewerTestHooks = { shiftDay, buildMarkdownRequestPath, buildChatRequestPayload, filterArticles };
  document.addEventListener("DOMContentLoaded", startViewer);
}
