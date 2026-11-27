// ブックマーク画面(src/bookmarksPage.ts が描画)の「外す」ボタン。
"use strict";

function startBookmarks() {
  const list = document.getElementById("bookmark-list");
  const count = document.getElementById("bookmark-count");
  const empty = document.getElementById("bookmark-empty");
  if (!list) {
    return;
  }

  list.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest(".bookmark-remove") : null;
    const card = button?.closest(".bookmark-card");
    if (!button || !card) {
      return;
    }
    button.disabled = true;
    button.classList.remove("is-error");
    try {
      const response = await fetch(`/api/favorites/${encodeURIComponent(card.dataset.appName)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ article_id: card.dataset.articleId, date: card.dataset.date }),
      });
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      card.remove();
      const remaining = list.querySelectorAll(".bookmark-card").length;
      count.textContent = `${remaining} 本`;
      empty.hidden = remaining > 0;
    } catch {
      button.disabled = false;
      button.classList.add("is-error");
      button.title = "外せませんでした。もう一度押してください";
      button.setAttribute("aria-label", button.title);
    }
  });
}

if (typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", startBookmarks);
}
