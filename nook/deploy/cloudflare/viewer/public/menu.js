// ハンバーガーメニュー(src/menu.ts が描画)の開閉。ホームと詳細画面の両方で読み込む。
"use strict";

const GENRE_OPEN_KEY = "nook.genreOpen";

function startMenu() {
  const button = document.getElementById("menu-button");
  const drawer = document.getElementById("tab-drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  const closeButton = document.getElementById("drawer-close");
  const genreToggle = document.getElementById("genre-toggle");
  const genreList = document.getElementById("tab-groups");
  if (!button || !drawer || !backdrop || !closeButton) {
    return;
  }

  function open() {
    drawer.hidden = false;
    backdrop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    (drawer.querySelector('.tab-item[aria-current="page"], .menu-item[aria-current="page"]') || closeButton).focus();
  }

  function close() {
    if (drawer.hidden) {
      return;
    }
    drawer.hidden = true;
    backdrop.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.focus();
  }

  function setGenreOpen(isOpen) {
    if (!genreToggle || !genreList) {
      return;
    }
    genreToggle.setAttribute("aria-expanded", String(isOpen));
    genreList.hidden = !isOpen;
    try {
      window.localStorage.setItem(GENRE_OPEN_KEY, String(isOpen));
    } catch {
      // 覚えられなくても開閉はできる
    }
  }

  let genreOpen = true;
  try {
    genreOpen = window.localStorage.getItem(GENRE_OPEN_KEY) !== "false";
  } catch {
    genreOpen = true;
  }
  setGenreOpen(genreOpen);

  button.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  genreToggle?.addEventListener("click", () => setGenreOpen(genreToggle.getAttribute("aria-expanded") !== "true"));
  // app.js の Escape(シートを閉じる)より先に、メニューを閉じる
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !drawer.hidden) {
        event.stopImmediatePropagation();
        close();
      }
    },
    true,
  );

  window.nookMenu = { open, close, isOpen: () => !drawer.hidden };
}

if (typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", startMenu);
}
