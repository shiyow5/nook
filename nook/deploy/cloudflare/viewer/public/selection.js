// 記事中の語を選んで用語辞書に登録する(#16)。詳細画面で app.js の後に読み込む。
// 本文の文字を選ぶと小さなボタンが出て、「辞書に登録」「⭐ 重要」「メモ」から登録の画面を開く。
// 説明は AI の下書き(/api/terms/draft)で埋め、直してから登録できる。
"use strict";

const MAX_SELECTION_CHARS = 80;

/** 選んだ文字を辞書の語として使える形にする。長すぎる・空のときは null。 */
function selectionWord(text) {
  const word = (text || "").replace(/\s+/g, " ").trim();
  return word && word.length <= MAX_SELECTION_CHARS ? word : null;
}

function startSelection() {
  const popup = document.getElementById("selection-popup");
  const dialog = document.getElementById("term-dialog");
  const reader = document.getElementById("reader");
  if (!popup || !dialog || !reader || typeof dialog.showModal !== "function") {
    return;
  }
  const $ = (id) => document.getElementById(id);
  const narrow = window.matchMedia("(max-width: 760px)");
  let selected = null;
  let timer = null;

  function hidePopup() {
    popup.hidden = true;
    selected = null;
  }

  function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    if (!element || !element.closest("#reader .article-body")) {
      return null;
    }
    const word = selectionWord(selection.toString());
    return word ? { word, rect: range.getBoundingClientRect() } : null;
  }

  function showPopup() {
    const found = readSelection();
    if (!found) {
      hidePopup();
      return;
    }
    selected = found.word;
    popup.hidden = false;
    if (narrow.matches) {
      // スマホは選択に出る標準のメニューと重ならないよう、画面の下に固定する
      popup.classList.add("is-docked");
      popup.style.left = "";
      popup.style.top = "";
      return;
    }
    popup.classList.remove("is-docked");
    const width = popup.offsetWidth;
    const left = Math.min(Math.max(8, found.rect.left + found.rect.width / 2 - width / 2), window.innerWidth - width - 8);
    const above = found.rect.top - popup.offsetHeight - 8;
    popup.style.left = `${left}px`;
    popup.style.top = `${above > 8 ? above : found.rect.bottom + 8}px`;
  }

  // 選び終わるまで待ってから出す(ドラッグ中や長押しの調整中に動かさない)
  document.addEventListener("selectionchange", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(showPopup, narrow.matches ? 450 : 200);
  });
  window.addEventListener("scroll", () => !popup.hidden && !narrow.matches && hidePopup(), { passive: true });

  async function draft(word) {
    const status = $("dialog-status");
    status.textContent = "AI が説明を下書きしています…";
    try {
      const response = await fetch("/api/terms/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || String(response.status));
      }
      if ($("dialog-word").value === word && !$("dialog-explanation").value) {
        $("dialog-explanation").value = payload.explanation;
      }
      status.textContent = "説明は AI の下書きです。必要なら直してから登録してください。";
    } catch {
      status.textContent = "下書きを作れませんでした。説明を入力してください。";
    }
  }

  function openDialog(mode) {
    const word = selected;
    hidePopup();
    if (!word) {
      return;
    }
    $("dialog-word").value = word;
    $("dialog-explanation").value = "";
    $("dialog-note").value = "";
    $("dialog-important").checked = mode === "important";
    $("dialog-status").textContent = "";
    dialog.showModal();
    (mode === "note" ? $("dialog-note") : $("dialog-explanation")).focus();
    draft(word);
  }

  popup.addEventListener("mousedown", (event) => event.preventDefault());
  popup.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-mode]") : null;
    if (button) {
      openDialog(button.dataset.mode);
    }
  });
  $("dialog-cancel").addEventListener("click", () => dialog.close());
  $("term-dialog-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const { app, date, article_id: articleId } = window.nookReader?.currentArticle() || {};
    const source = { app, date, article_id: articleId };
    const save = $("dialog-save");
    save.disabled = true;
    try {
      const response = await fetch("/api/terms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word: $("dialog-word").value,
          explanation: $("dialog-explanation").value,
          note: $("dialog-note").value,
          important: $("dialog-important").checked,
          ...source,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || String(response.status));
      }
      dialog.close();
      window.getSelection()?.removeAllRanges();
      const status = document.getElementById("status-message");
      if (status) {
        status.textContent = `「${payload.term.word}」を用語辞書に登録しました。`;
      }
    } catch (error) {
      $("dialog-status").textContent = `登録できませんでした(${error.message})。`;
    } finally {
      save.disabled = false;
    }
  });
}

if (typeof window !== "undefined") {
  window.__nookSelectionTestHooks = { selectionWord };
  document.addEventListener("DOMContentLoaded", startSelection);
}
