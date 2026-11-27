// アーカイブ画面(#15)のカードとリストの切り替え。選んだ形はこのブラウザに覚える。
"use strict";

const ARCHIVE_VIEW_KEY = "nook.archiveView";

function startArchive() {
  const list = document.getElementById("archive-list");
  const cards = document.getElementById("archive-view-cards");
  const rows = document.getElementById("archive-view-list");
  if (!list || !cards || !rows) {
    return;
  }
  function apply(view) {
    list.classList.toggle("is-cards", view === "cards");
    list.classList.toggle("is-rows", view === "list");
    cards.setAttribute("aria-pressed", String(view === "cards"));
    rows.setAttribute("aria-pressed", String(view === "list"));
    try {
      window.localStorage.setItem(ARCHIVE_VIEW_KEY, view);
    } catch {
      // 覚えられなくても切り替えはできる
    }
  }
  let initial = "cards";
  try {
    initial = window.localStorage.getItem(ARCHIVE_VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    initial = "cards";
  }
  apply(initial);
  cards.addEventListener("click", () => apply("cards"));
  rows.addEventListener("click", () => apply("list"));
}

if (typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", startArchive);
}
