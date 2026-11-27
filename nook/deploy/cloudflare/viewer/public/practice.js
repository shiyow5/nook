// 演習パネル(src/page.ts が描画)。#19 の要約の添削と、これまでのやり取りの表示を受け持つ。
// 今の記事は app.js の window.nookReader から受け取り、"nook:panels-render" の合図で描き直す。
"use strict";

const MIN_SUMMARY_CHARS = 20;
const REVIEW_SECTIONS = [
  ["understood", "正しく理解できている点", "is-good"],
  ["gaps", "ずれている点", "is-gap"],
  ["extras", "さらに深める補足", "is-extra"],
];

const CASE_SECTIONS = [
  ["good_points", "良い判断", "is-good"],
  ["risks", "見落としやすいリスク", "is-gap"],
];
const MIN_ANSWER_CHARS = 10;

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
      entries.set(key, {
        sessions: [],
        status: "idle",
        draft: "",
        pending: false,
        error: "",
        latest: null,
        // ケーススタディ: 問題、出したヒントの数、回答の下書き、レビュー
        caseQuestion: null,
        caseStatus: "idle",
        caseError: "",
        hintsShown: 0,
        answer: "",
        casePending: false,
        caseReview: null,
      });
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

  function caseReviewBlock(output) {
    const wrapper = document.createElement("div");
    wrapper.className = "review-output";
    for (const [field, title, className] of CASE_SECTIONS) {
      const items = Array.isArray(output[field]) ? output[field] : [];
      const box = document.createElement("div");
      box.className = `review-box ${className}`;
      const heading = document.createElement("h4");
      heading.textContent = title;
      box.append(heading, items.length ? list("review-items", items) : list("review-items is-empty", ["特になし"]));
      wrapper.append(box);
    }
    const model = document.createElement("div");
    model.className = "review-box is-extra";
    const heading = document.createElement("h4");
    heading.textContent = "模範解答の例";
    const body = document.createElement("p");
    body.className = "model-answer";
    body.textContent = output.model_answer || "";
    model.append(heading, body);
    wrapper.append(model);
    return wrapper;
  }

  function caseText(caseQuestion) {
    const box = document.createElement("div");
    box.className = "case-question";
    const situation = document.createElement("p");
    situation.className = "case-situation";
    situation.textContent = caseQuestion.situation;
    const question = document.createElement("p");
    question.className = "case-ask";
    question.textContent = `問い: ${caseQuestion.question}`;
    box.append(situation, question);
    return box;
  }

  function button(label, className, onClick) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = className;
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  }

  function renderCase(article, entry) {
    const area = $("case-area");
    if (!entry) {
      area.replaceChildren();
      return;
    }
    if (entry.caseStatus === "loading") {
      const busy = document.createElement("p");
      busy.className = "skeleton-caption";
      busy.setAttribute("aria-busy", "true");
      busy.textContent = "AI が問題を作っています…";
      area.replaceChildren(busy);
      return;
    }
    if (!entry.caseQuestion) {
      const nodes = [button("問題を出してもらう", "accent-solid-button study-wide", () => loadCase(article, false))];
      if (entry.caseError) {
        const error = document.createElement("p");
        error.className = "study-error";
        error.textContent = entry.caseError;
        nodes.unshift(error);
      }
      area.replaceChildren(...nodes);
      return;
    }
    const nodes = [caseText(entry.caseQuestion)];
    const hints = entry.caseQuestion.hints || [];
    if (entry.hintsShown > 0) {
      nodes.push(list("case-hints", hints.slice(0, entry.hintsShown).map((hint, index) => `ヒント ${index + 1}: ${hint}`)));
    }
    if (entry.hintsShown < hints.length) {
      nodes.push(
        button(entry.hintsShown ? "次のヒントを見る" : "ヒントを見る", "text-button", () => {
          entry.hintsShown += 1;
          render();
        }),
      );
    }
    const form = document.createElement("form");
    form.className = "practice-form";
    const textarea = document.createElement("textarea");
    textarea.rows = 5;
    textarea.maxLength = 3000;
    textarea.placeholder = "自分ならどう判断・対応するか";
    textarea.setAttribute("aria-label", "ケーススタディへの回答");
    textarea.value = entry.answer;
    textarea.disabled = entry.casePending;
    const foot = document.createElement("div");
    foot.className = "practice-form-foot";
    const count = document.createElement("span");
    count.className = "practice-count";
    count.textContent = `${entry.answer.trim().length} 字`;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "accent-solid-button";
    submit.textContent = entry.casePending ? "レビューしています…" : "AI にレビューしてもらう";
    submit.disabled = entry.casePending || entry.answer.trim().length < MIN_ANSWER_CHARS;
    textarea.addEventListener("input", () => {
      entry.answer = textarea.value;
      count.textContent = `${entry.answer.trim().length} 字`;
      submit.disabled = entry.casePending || entry.answer.trim().length < MIN_ANSWER_CHARS;
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      reviewCase(article);
    });
    foot.append(count, submit);
    form.append(textarea, foot);
    nodes.push(form);
    if (entry.caseError) {
      const error = document.createElement("p");
      error.className = "study-error";
      error.textContent = entry.caseError;
      nodes.push(error);
    }
    if (entry.caseReview) {
      nodes.push(caseReviewBlock(entry.caseReview.output));
    }
    nodes.push(button("別の問題にする", "text-button", () => loadCase(article, true)));
    area.replaceChildren(...nodes);
  }

  async function postPractice(article, body) {
    const response = await fetch(`/api/practice/${encodeURIComponent(article.app)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: article.date, article_id: article.article_id, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || `うまくいきませんでした(${response.status})`);
    }
    return payload;
  }

  async function loadCase(article, fresh) {
    const entry = entryOf(article);
    entry.caseStatus = "loading";
    entry.caseError = "";
    render();
    try {
      const { case: caseQuestion } = await postPractice(article, { kind: "case_question", fresh });
      entry.caseQuestion = caseQuestion;
      entry.hintsShown = 0;
      entry.answer = "";
      entry.caseReview = null;
    } catch (error) {
      entry.caseError = error instanceof Error ? error.message : "問題を作れませんでした。";
    } finally {
      entry.caseStatus = "ready";
      render();
    }
  }

  async function reviewCase(article) {
    const entry = entryOf(article);
    entry.casePending = true;
    entry.caseError = "";
    render();
    try {
      const { session } = await postPractice(article, { kind: "case_review", answer: entry.answer });
      entry.caseReview = session;
      entry.sessions = [session, ...entry.sessions];
    } catch (error) {
      entry.caseError = error instanceof Error ? error.message : "レビューできませんでした。";
    } finally {
      entry.casePending = false;
      render();
    }
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
    } else if (session.kind === "case") {
      const mine = document.createElement("p");
      mine.className = "history-input";
      mine.textContent = `回答: ${session.input.answer || ""}`;
      details.append(caseText(session.input), mine, caseReviewBlock(session.output));
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

    renderCase(article, entry);

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
