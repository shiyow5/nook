// 画面で使う線画のアイコン(Lucide 風)と nook のアイコンの URL。
export const ICON_URL = "https://api.dicebear.com/7.x/shapes";

export const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"></path>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
  panelClose: '<rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M9 4v16M15 10l-2 2 2 2"></path>',
  panelOpen: '<rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M9 4v16M13 10l2 2-2 2"></path>',
  settings:
    '<circle cx="12" cy="12" r="3"></circle><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"></path>',
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"></path>',
  bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path>',
  history: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  genre: '<path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z"></path>',
  glossary: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11"></path>',
  pencil: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"></rect><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"></path>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"></path>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>',
  chevronLeft: '<path d="m15 6-6 6 6 6"></path>',
  chevronRight: '<path d="m9 6 6 6-6 6"></path>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"></path>',
  close: '<path d="M6 6l12 12M18 6 6 18"></path>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"></path>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"></rect><rect x="13" y="4" width="7" height="7" rx="1"></rect><rect x="4" y="13" width="7" height="7" rx="1"></rect><rect x="13" y="13" width="7" height="7" rx="1"></rect>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"></path>',
  book: '<path d="M4 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4zM20 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z"></path>',
};

export function icon(name: keyof typeof ICONS, size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** 画面の JavaScript が描くボタンのアイコン。シェルに 1 度だけ埋め込み、`<use href="#icon-名前">` で参照する。 */
const CLIENT_ICONS: Array<keyof typeof ICONS> = ["trash", "pencil", "external", "chevronLeft", "chevronRight", "star", "close"];

export function iconSprite(): string {
  const symbols = CLIENT_ICONS.map(
    (name) =>
      `<symbol id="icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</symbol>`,
  ).join("");
  return `<svg class="icon-sprite" width="0" height="0" aria-hidden="true" style="position:absolute">${symbols}</svg>`;
}

/** アイコンだけのボタンの中身。読み上げとマウスを重ねたときの説明は、呼び出し側が aria-label と title に入れる。 */
export function iconButtonAttributes(label: string): string {
  const safe = label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `aria-label="${safe}" title="${safe}"`;
}
