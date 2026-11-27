// ホーム(src/home.ts が描画)の動き。日付の移動、その日の全記事の検索、「続きから読む」を受け持つ。
"use strict";

const LAST_READ_KEY = "nook.lastRead";
const SEARCH_LIMIT = 50;

function shiftHomeDay(day, delta) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function searchHomeArticles(articles, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  return articles.filter((article) => {
    const text = `${article.title} ${article.source || ""} ${article.label}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

function readLastRead() {
  try {
    const value = JSON.parse(window.localStorage.getItem(LAST_READ_KEY) || "null");
    return value && typeof value.app_name === "string" && typeof value.title === "string" ? value : null;
  } catch {
    return null;
  }
}

function lastReadHref(lastRead, today) {
  const params = new URLSearchParams({ tab: lastRead.app_name });
  if (lastRead.date && lastRead.date !== today) {
    params.set("date", lastRead.date);
  }
  if (lastRead.article_id) {
    params.set("article", lastRead.article_id);
  }
  return `/read?${params.toString()}`;
}

function startHome() {
  const stateNode = document.getElementById("home-state");
  if (!stateNode) {
    return;
  }
  const state = JSON.parse(stateNode.textContent);
  const $ = (id) => document.getElementById(id);
  const dateInput = $("date");

  function goToDay(day) {
    window.location.href = !day || day === state.today ? "/" : `/?date=${encodeURIComponent(day)}`;
  }

  dateInput.addEventListener("click", () => {
    try {
      dateInput.showPicker();
    } catch {
      // showPicker が無いブラウザでは、入力欄そのものの動きに任せる
    }
  });
  dateInput.addEventListener("change", () => dateInput.value && goToDay(dateInput.value));
  $("date-form").addEventListener("submit", (event) => {
    event.preventDefault();
    goToDay(dateInput.value);
  });
  $("prev-day").addEventListener("click", () => goToDay(shiftHomeDay(state.date, -1)));
  $("next-day").addEventListener("click", () => goToDay(shiftHomeDay(state.date, 1)));
  $("today-button").addEventListener("click", () => goToDay(state.today));

  const lastRead = readLastRead();
  if (lastRead) {
    const card = $("resume-card");
    card.href = lastReadHref(lastRead, state.today);
    const position = lastRead.position && lastRead.total ? ` ${lastRead.position} / ${lastRead.total}` : "";
    $("resume-meta").textContent = `続きから読む · ${lastRead.label || lastRead.app_name}${position}`;
    $("resume-title").textContent = lastRead.title;
    card.hidden = false;
  }

  const searchInput = $("home-search");
  const results = $("search-results");
  const sections = $("home-sections");
  searchInput.addEventListener("input", () => {
    const query = searchInput.value;
    const matches = searchHomeArticles(state.articles, query);
    const searching = query.trim() !== "";
    results.hidden = !searching;
    sections.hidden = searching;
    if (!searching) {
      return;
    }
    $("search-count").textContent = matches.length
      ? `${matches.length} 本${matches.length > SEARCH_LIMIT ? `(先頭の ${SEARCH_LIMIT} 本を表示)` : ""}`
      : "見つかりませんでした";
    $("search-list").replaceChildren(
      ...matches.slice(0, SEARCH_LIMIT).map((article) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = article.href;
        const meta = document.createElement("span");
        meta.className = "row-source";
        meta.textContent = article.source ? `${article.label} · ${article.source}` : article.label;
        const title = document.createElement("span");
        title.className = "row-title";
        title.textContent = article.title;
        link.append(meta, title);
        item.append(link);
        return item;
      }),
    );
  });
}

if (typeof window !== "undefined") {
  window.__nookHomeTestHooks = { shiftHomeDay, searchHomeArticles, lastReadHref };
  document.addEventListener("DOMContentLoaded", startHome);
}
