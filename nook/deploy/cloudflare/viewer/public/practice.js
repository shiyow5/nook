// 演習パネル(src/page.ts が描画)。#19 の要約の添削と、これまでのやり取りの表示を受け持つ。
// 今の記事は app.js の window.nookReader から受け取り、"nook:panels-render" の合図で描き直す。
"use strict";

const MIN_SUMMARY_CHARS = 20;
const REVIEW_SECTIONS = [
  ["understood", "正しく理解できている点", "is-good"],
  ["gaps", "ずれている点", "is-gap"],
  ["extras", "さらに深める補足", "is-extra"],
];

function articleKey(article) {
  return article ? `${article.app}:${article.date}:${article.article_id}` : "";
}

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function startPractice() {
  const panel = document.getElementById("practice-panel");
  if (!panel) {
    return;
  }
  const $ = (id) => document.getElementById(id);
  // 記事ごとの状態: { sessions, status: idle|loading|ready|error, draft, pending, error }
  const entries = new Map();
  let shownKey = "";

  function entryOf(article) {
    const key = articleKey(article);
    if (!entries.has(key)) {
      entries.set(key, { sessions: [], status: "idle", draft: "", pending: false, error: "", latest: null });
    }
    return entries.get(key);
  }

  function list(className, items) {
    const ul = document.createElement("ul");
    ul.className = className;
    for (const text of items) {
      const li = document.createElement("li");
      li.textContent = text;
      ul.append(li);
    }
    return ul;
  }

  function reviewBlock(output) {
    const wrapper = document.createElement("div");
    wrapper.className = "review-output";
    for (const [field, title, className] of REVIEW_SECTIONS) {
      const items = Array.isArray(output[field]) ? output[field] : [];
      const box = document.createElement("div");
      box.className = `review-box ${className}`;
      const heading = document.createElement("h4");
      heading.textContent = title;
      box.append(heading, items.length ? list("review-items", items) : list("review-items is-empty", ["特になし"]));
      wrapper.append(box);
    }
    return wrapper;
  }

  function historyItem(session) {
    const details = document.createElement("details");
    details.className = "history-item";
    const summary = document.createElement("summary");
    summary.textContent = `${session.kind === "review" ? "要約の添削" : "ケーススタディ"} · ${formatTime(session.created_at)}`;
    details.append(summary);
    if (session.kind === "review") {
      const mine = document.createElement("p");
      mine.className = "history-input";
      mine.textContent = session.input.summary || "";
      details.append(mine, reviewBlock(session.output));
    }
    return details;
  }

  function render() {
    const article = window.nookReader?.currentArticle() || null;
    const key = articleKey(article);
    const entry = article ? entryOf(article) : null;
    $("practice-article").textContent = article
      ? `対象: ${article.title}`
      : "記事を選ぶと、その記事で演習できます。";
    const input = $("review-input");
    if (key !== shownKey) {
      input.value = entry?.draft || "";
      shownKey = key;
    }
    const length = input.value.trim().length;
    $("review-count").textContent = `${length} 字`;
    $("review-submit").disabled = !entry || entry.pending || length < MIN_SUMMARY_CHARS;
    $("review-submit").textContent = entry?.pending ? "添削しています…" : "AI に添削してもらう";
    input.disabled = !entry || entry.pending;

    const result = $("review-result");
    if (!entry) {
      result.replaceChildren();
    } else if (entry.pending) {
      const busy = document.createElement("p");
      busy.className = "skeleton-caption";
      busy.setAttribute("aria-busy", "true");
      busy.textContent = "AI が記事と見比べて添削しています…";
      result.replaceChildren(busy);
    } else if (entry.error) {
      const error = document.createElement("p");
      error.className = "study-error";
      error.textContent = entry.error;
      result.replaceChildren(error);
    } else {
      result.replaceChildren(...(entry.latest ? [reviewBlock(entry.latest.output)] : []));
    }

    const history = $("practice-history");
    if (!entry || entry.status === "idle" || entry.status === "loading") {
      const loading = document.createElement("p");
      loading.className = "skeleton-caption";
      loading.textContent = "読み込んでいます…";
      history.replaceChildren(loading);
    } else if (entry.status === "error") {
      const error = document.createElement("p");
      error.className = "study-error";
      error.textContent = "これまでのやり取りを読み込めませんでした。";
      history.replaceChildren(error);
    } else if (entry.sessions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "practice-note";
      empty.textContent = "まだありません。";
      history.replaceChildren(empty);
    } else {
      history.replaceChildren(...entry.sessions.map(historyItem));
    }
  }

  async function loadHistory(article) {
    const entry = entryOf(article);
    if (entry.status !== "idle") {
      return;
    }
    entry.status = "loading";
    try {
      const params = new URLSearchParams({ date: article.date, article_id: article.article_id });
      const response = await fetch(`/api/practice/${encodeURIComponent(article.app)}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      entry.sessions = (await response.json()).sessions || [];
      entry.status = "ready";
    } catch {
      entry.status = "error";
    }
    render();
  }

  function refresh() {
    const article = window.nookReader?.currentArticle();
    if (article) {
      loadHistory(article);
    }
    render();
  }

  document.addEventListener("nook:panels-render", (event) => {
    if (event.detail?.practiceOpen) {
      refresh();
    }
  });
  // app.js が先に描いたとき(パネルを開いたまま読み込み直したとき)は、ここで一度描く
  if (!panel.hidden) {
    refresh();
  }

  $("review-input").addEventListener("input", () => {
    const article = window.nookReader?.currentArticle();
    if (article) {
      entryOf(article).draft = $("review-input").value;
    }
    render();
  });

  $("review-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const article = window.nookReader?.currentArticle();
    if (!article) {
      return;
    }
    const entry = entryOf(article);
    entry.pending = true;
    entry.error = "";
    render();
    try {
      const response = await fetch(`/api/practice/${encodeURIComponent(article.app)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "review", date: article.date, article_id: article.article_id, summary: entry.draft }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || `添削できませんでした(${response.status})`);
      }
      entry.latest = payload.session;
      entry.sessions = [payload.session, ...entry.sessions];
    } catch (error) {
      entry.error = error instanceof Error ? error.message : "添削できませんでした。";
    } finally {
      entry.pending = false;
      render();
    }
  });
}

if (typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", startPractice);
}
