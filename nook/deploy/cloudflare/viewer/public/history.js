// 履歴画面(src/historyPage.ts が描画)の「履歴から消す」と「すべて消す」。
"use strict";

function startHistory() {
  const list = document.getElementById("history-list");
  const count = document.getElementById("history-count");
  const empty = document.getElementById("history-empty");
  const clear = document.getElementById("history-clear");
  if (!list) {
    return;
  }

  function refresh() {
    list.querySelectorAll(".history-group").forEach((group) => {
      if (!group.querySelector(".history-card")) {
        group.remove();
      }
    });
    const remaining = list.querySelectorAll(".history-card").length;
    count.textContent = `${remaining} 本`;
    empty.hidden = remaining > 0;
    clear.hidden = remaining === 0;
  }

  list.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest(".history-remove") : null;
    const card = button?.closest(".history-card");
    if (!button || !card) {
      return;
    }
    button.disabled = true;
    button.classList.remove("is-error");
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(card.dataset.appName)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ article_id: card.dataset.articleId, date: card.dataset.date }),
      });
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      card.remove();
      refresh();
    } catch {
      button.disabled = false;
      button.classList.add("is-error");
      button.title = "消せませんでした。もう一度押してください";
      button.setAttribute("aria-label", button.title);
    }
  });

  clear.addEventListener("click", async () => {
    if (!window.confirm("履歴をすべて消します。よろしいですか。")) {
      return;
    }
    clear.disabled = true;
    try {
      const response = await fetch("/api/history", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      list.replaceChildren();
      refresh();
    } catch {
      clear.textContent = "消せませんでした。もう一度";
    } finally {
      clear.disabled = false;
    }
  });
}

if (typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", startHistory);
}
