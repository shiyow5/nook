// 用語辞書(src/glossaryPage.ts が描画、#17)。一覧の並べ替え・頭文字の索引・表示の切り替え・編集を受け持つ。
"use strict";

const VIEW_KEY = "nook.glossaryView";
const INDEX_GROUPS = ["英数", "あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ", "他"];
// ひらがなの行の先頭(この文字以上、次の行の先頭未満がその行)
const KANA_ROWS = [
  ["あ", "ぁ"],
  ["か", "か"],
  ["さ", "さ"],
  ["た", "た"],
  ["な", "な"],
  ["は", "は"],
  ["ま", "ま"],
  ["や", "ゃ"],
  ["ら", "ら"],
  ["わ", "ゎ"],
];

function toHiragana(text) {
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

/** 英字か数字で始まる語は「英数」、それ以外は読み(なければ語)の 1 文字目で行を決める。漢字だけで読みがない語は「他」。 */
function indexGroup(term) {
  if (/^[A-Za-z0-9]/.test((term.word || "").trim().normalize("NFKC"))) {
    return "英数";
  }
  const first = toHiragana((term.reading || term.word || "").trim().normalize("NFKC")).charAt(0);
  if (!/[ぁ-ゖ]/.test(first)) {
    return "他";
  }
  let group = "他";
  for (const [row, start] of KANA_ROWS) {
    if (first >= start) {
      group = row;
    }
  }
  return group;
}

function sortTerms(terms, mode) {
  const byName = (a, b) => (a.reading || a.word).localeCompare(b.reading || b.word, "ja");
  const byNew = (a, b) => b.created_at.localeCompare(a.created_at);
  const sorters = {
    new: byNew,
    name: byName,
    important: (a, b) => Number(b.important) - Number(a.important) || byNew(a, b),
    learning: (a, b) => Number(a.status === "understood") - Number(b.status === "understood") || byNew(a, b),
  };
  return [...terms].sort(sorters[mode] || byNew);
}

function matchesQuery(term, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${term.word} ${term.reading || ""} ${term.explanation} ${term.note || ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

function startGlossary() {
  const stateNode = document.getElementById("glossary-state");
  if (!stateNode) {
    return;
  }
  const state = JSON.parse(stateNode.textContent);
  const $ = (id) => document.getElementById(id);
  const ui = { query: "", sort: "new", group: "すべて", view: "list", editing: null, flipped: new Set() };
  try {
    ui.view = window.localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "list";
  } catch {
    ui.view = "list";
  }

  async function send(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) {
      throw new Error(payload.detail || `保存できませんでした(${response.status})`);
    }
    return payload;
  }

  function replaceTerm(term) {
    state.terms = [term, ...state.terms.filter((item) => item.id !== term.id)];
  }

  function sourceLink(term) {
    if (!term.app || !term.date || !term.article_id) {
      return null;
    }
    const link = document.createElement("a");
    const params = new URLSearchParams({ tab: term.app, date: term.date, article: term.article_id });
    link.href = `/read?${params.toString()}`;
    link.className = "term-source";
    link.textContent = `出典: ${state.tab_labels[term.app] || term.app} · ${term.date}`;
    return link;
  }

  function actionButton(label, onClick, pressed) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.textContent = label;
    if (pressed !== undefined) {
      button.setAttribute("aria-pressed", String(pressed));
    }
    button.addEventListener("click", onClick);
    return button;
  }

  async function patch(term, fields) {
    try {
      const { term: updated } = await send("PATCH", `/api/terms/${term.id}`, fields);
      replaceTerm(updated);
      ui.editing = null;
      render();
    } catch (error) {
      window.alert(error.message);
    }
  }

  function editForm(term) {
    const form = document.createElement("form");
    form.className = "term-edit";
    const field = (labelText, name, value, multiline) => {
      const label = document.createElement("label");
      label.textContent = labelText;
      const input = document.createElement(multiline ? "textarea" : "input");
      input.name = name;
      input.value = value || "";
      if (multiline) {
        input.rows = 3;
      }
      label.append(input);
      return label;
    };
    form.append(
      field("用語", "word", term.word, false),
      field("読み", "reading", term.reading, false),
      field("説明", "explanation", term.explanation, true),
      field("メモ", "note", term.note, true),
    );
    const actions = document.createElement("div");
    actions.className = "term-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "primary-button";
    save.textContent = "保存";
    actions.append(save, actionButton("やめる", () => {
      ui.editing = null;
      render();
    }));
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      patch(term, {
        word: data.get("word"),
        reading: data.get("reading"),
        explanation: data.get("explanation"),
        note: data.get("note"),
      });
    });
    return form;
  }

  function termItem(term) {
    const item = document.createElement("li");
    item.className = `term-item${term.status === "understood" ? " is-understood" : ""}`;
    if (ui.editing === term.id) {
      item.append(editForm(term));
      return item;
    }
    const head = document.createElement("div");
    head.className = "term-head";
    const word = document.createElement("span");
    word.className = "term-word";
    word.textContent = `${term.important ? "★ " : ""}${term.word}`;
    head.append(word);
    if (term.reading) {
      const reading = document.createElement("span");
      reading.className = "term-reading";
      reading.textContent = term.reading;
      head.append(reading);
    }
    const status = document.createElement("span");
    status.className = "term-status";
    status.textContent = term.status === "understood" ? "理解できた" : "これから覚える";
    head.append(status);

    const body = document.createElement("div");
    body.className = "term-body";
    const explanation = document.createElement("p");
    explanation.className = "term-text";
    explanation.textContent = term.explanation;
    body.append(explanation);
    if (term.note) {
      const note = document.createElement("p");
      note.className = "term-note";
      note.textContent = `メモ: ${term.note}`;
      body.append(note);
    }
    const source = sourceLink(term);
    if (source) {
      body.append(source);
    }

    const actions = document.createElement("div");
    actions.className = "term-actions";
    actions.append(
      actionButton(term.important ? "★ 重要" : "☆ 重要", () => patch(term, { important: !term.important }), term.important),
      actionButton(
        term.status === "understood" ? "これから覚えるに戻す" : "理解できた",
        () => patch(term, { status: term.status === "understood" ? "learning" : "understood" }),
      ),
      actionButton("編集", () => {
        ui.editing = term.id;
        render();
      }),
      actionButton("削除", async () => {
        if (!window.confirm(`「${term.word}」を辞書から削除しますか?`)) {
          return;
        }
        try {
          await send("DELETE", `/api/terms/${term.id}`);
          state.terms = state.terms.filter((itemTerm) => itemTerm.id !== term.id);
          render();
        } catch (error) {
          window.alert(error.message);
        }
      }),
    );

    if (ui.view === "cards") {
      // 単語カード: 表は語と読み、押すと裏返して説明を見せる
      item.classList.add("is-card");
      const flipped = ui.flipped.has(term.id);
      item.classList.toggle("is-flipped", flipped);
      const face = document.createElement("button");
      face.type = "button";
      face.className = "card-face";
      face.setAttribute("aria-expanded", String(flipped));
      face.append(head);
      if (!flipped) {
        const hint = document.createElement("span");
        hint.className = "card-hint";
        hint.textContent = "押すと説明を表示";
        face.append(hint);
      }
      face.addEventListener("click", () => {
        if (ui.flipped.has(term.id)) {
          ui.flipped.delete(term.id);
        } else {
          ui.flipped.add(term.id);
        }
        render();
      });
      item.append(face);
      if (flipped) {
        item.append(body, actions);
      }
      return item;
    }
    item.append(head, body, actions);
    return item;
  }

  function renderIndex(visible) {
    const counts = Object.fromEntries(INDEX_GROUPS.map((group) => [group, 0]));
    for (const term of visible) {
      counts[indexGroup(term)] += 1;
    }
    $("glossary-index").replaceChildren(
      ...["すべて", ...INDEX_GROUPS].map((group) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chip";
        button.textContent = group;
        button.setAttribute("aria-pressed", String(ui.group === group));
        button.disabled = group !== "すべて" && counts[group] === 0;
        button.addEventListener("click", () => {
          ui.group = group;
          render();
        });
        return button;
      }),
    );
  }

  function render() {
    const total = state.terms.length;
    const understood = state.terms.filter((term) => term.status === "understood").length;
    $("progress-text").textContent = `全 ${total} 語中 ${understood} 語を理解`;
    $("progress-bar").style.width = total ? `${Math.round((understood / total) * 100)}%` : "0%";
    $("view-list").setAttribute("aria-pressed", String(ui.view === "list"));
    $("view-cards").setAttribute("aria-pressed", String(ui.view === "cards"));

    const searched = state.terms.filter((term) => matchesQuery(term, ui.query));
    renderIndex(searched);
    const visible = sortTerms(
      searched.filter((term) => ui.group === "すべて" || indexGroup(term) === ui.group),
      ui.sort,
    );
    const important = visible.filter((term) => term.important);
    $("important-box").hidden = important.length === 0;
    $("important-count").textContent = `(${important.length})`;
    for (const list of [$("important-list"), $("glossary-list")]) {
      list.classList.toggle("is-cards", ui.view === "cards");
    }
    $("important-list").replaceChildren(...important.map(termItem));
    $("glossary-list").replaceChildren(...visible.filter((term) => !term.important).map(termItem));
    const empty = $("glossary-empty");
    empty.hidden = visible.length > 0;
    empty.textContent = total
      ? "条件に合う用語がありません。"
      : "まだ用語がありません。上の「用語を追加する」か、学びパネルの用語カードの「辞書に追加」から登録できます。";
  }

  $("glossary-search").addEventListener("input", (event) => {
    ui.query = event.target.value;
    render();
  });
  $("glossary-sort").addEventListener("change", (event) => {
    ui.sort = event.target.value;
    render();
  });
  for (const [id, view] of [
    ["view-list", "list"],
    ["view-cards", "cards"],
  ]) {
    $(id).addEventListener("click", () => {
      ui.view = view;
      try {
        window.localStorage.setItem(VIEW_KEY, view);
      } catch {
        // 覚えられなくても切り替えはできる
      }
      render();
    });
  }

  const formStatus = $("term-form-status");
  $("term-draft").addEventListener("click", async () => {
    const word = $("term-word").value.trim();
    if (!word) {
      formStatus.textContent = "先に用語を入力してください。";
      return;
    }
    const button = $("term-draft");
    button.disabled = true;
    formStatus.textContent = "AI が下書きしています…";
    try {
      const draft = await send("POST", "/api/terms/draft", { word });
      if (!$("term-reading").value) {
        $("term-reading").value = draft.reading || "";
      }
      $("term-explanation").value = draft.explanation;
      formStatus.textContent = "下書きを入れました。必要なら直してから追加してください。";
    } catch (error) {
      formStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $("term-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    try {
      const { term } = await send("POST", "/api/terms", {
        word: data.get("word"),
        reading: data.get("reading"),
        explanation: data.get("explanation"),
        note: data.get("note"),
        important: data.get("important") === "on",
      });
      replaceTerm(term);
      form.reset();
      formStatus.textContent = `「${term.word}」を追加しました。`;
      render();
    } catch (error) {
      formStatus.textContent = error.message;
    }
  });

  render();
}

if (typeof window !== "undefined") {
  window.__nookGlossaryTestHooks = { indexGroup, sortTerms, matchesQuery, toHiragana };
  document.addEventListener("DOMContentLoaded", startGlossary);
}
