// 設定画面(#7)。#settings-state の defaults(TOML から作った初期値)と settings(保存済みの上書き)を編集する。
"use strict";

// アイコンだけのボタンにする。図柄はシェルに埋め込んだ <symbol id="icon-…">(src/icons.ts)を使う
function makeIconButton(element, name, label) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  element.classList.add("icon-button");
  element.setAttribute("aria-label", label);
  element.title = label;
  element.replaceChildren(svg);
  return element;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeFeeds(rss) {
  return {
    max_entries_per_feed: rss.max_entries_per_feed,
    feeds: rss.feeds.map((feed) => ({
      name: feed.name,
      feed_name_display: feed.feed_name_display,
      url: feed.url,
      keywords: feed.keywords && feed.keywords.length ? [...feed.keywords] : null,
    })),
  };
}

/** 初期値と同じものは送らず、変えた部分だけを保存する(TOML を直したときに反映されるように)。 */
function buildSettingsPayload(working, defaults, rssServices) {
  const collectors = {};
  for (const [name, enabled] of Object.entries(working.collectors)) {
    if (!enabled) {
      collectors[name] = { enabled: false };
    }
  }
  const rss = {};
  for (const service of rssServices) {
    const current = working.rss[service];
    const initial = defaults.rss?.[service];
    if (current && (!initial || JSON.stringify(normalizeFeeds(current)) !== JSON.stringify(normalizeFeeds(initial)))) {
      rss[service] = normalizeFeeds(current);
    }
  }
  return { version: 1, collectors, rss };
}

function feedIdFrom(url, existing) {
  let base = "feed";
  try {
    const parsed = new URL(url);
    base = `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "feed";
  } catch {
    // URL として読めないときは feed のままにし、保存時の検証で知らせる
  }
  let candidate = base;
  for (let suffix = 2; existing.has(candidate); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

function startSettings() {
  const node = document.getElementById("settings-state");
  if (!node) {
    return;
  }
  const state = JSON.parse(node.textContent);
  const $ = (id) => document.getElementById(id);
  const el = {
    collectorList: $("collector-list"),
    service: $("rss-service"),
    limit: $("rss-limit"),
    reset: $("rss-reset"),
    feedList: $("feed-list"),
    addForm: $("feed-add"),
    addName: $("feed-add-name"),
    addUrl: $("feed-add-url"),
    empty: $("settings-empty"),
    saveBar: $("save-bar"),
    saveMessage: $("save-message"),
    cancel: $("save-cancel"),
    submit: $("save-submit"),
  };
  const defaults = state.defaults;
  if (!defaults || !Array.isArray(defaults.collectors)) {
    document.querySelectorAll(".settings-card").forEach((card) => {
      card.hidden = true;
    });
    el.empty.hidden = false;
    return;
  }
  const saved = state.settings || {};
  const rssServices = state.rss_services.filter((service) => defaults.rss?.[service]);
  const label = (name) => state.tab_meta[name]?.label || name;

  let working = {
    collectors: Object.fromEntries(
      defaults.collectors.map((name) => [name, saved.collectors?.[name]?.enabled !== false]),
    ),
    rss: Object.fromEntries(rssServices.map((service) => [service, clone(saved.rss?.[service] || defaults.rss[service])])),
  };
  let baseline = JSON.stringify(working);
  let currentService = rssServices.includes("jp_tech_news") ? "jp_tech_news" : rssServices[0];

  function isDirty() {
    return JSON.stringify(working) !== baseline;
  }

  function updateSaveBar(message) {
    const dirty = isDirty();
    el.saveBar.hidden = !dirty && !message;
    el.saveMessage.textContent = message || (dirty ? "未保存の変更があります。保存すると次回の収集から使われます。" : "");
    el.submit.disabled = !dirty;
    el.cancel.disabled = !dirty;
  }

  function renderCollectors() {
    el.collectorList.replaceChildren(
      ...defaults.collectors.map((name) => {
        const row = document.createElement("div");
        row.className = "collector-row";
        const info = document.createElement("div");
        info.className = "collector-info";
        const title = document.createElement("span");
        title.className = "collector-name";
        title.textContent = label(name);
        const desc = document.createElement("span");
        desc.className = "collector-desc";
        desc.textContent = state.tab_meta[name]?.description || name;
        info.append(title, desc);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "switch";
        toggle.setAttribute("role", "switch");
        toggle.setAttribute("aria-checked", String(working.collectors[name]));
        toggle.setAttribute("aria-label", `${label(name)} を毎朝収集する`);
        toggle.addEventListener("click", () => {
          working.collectors[name] = !working.collectors[name];
          renderCollectors();
          updateSaveBar();
        });
        row.append(info, toggle);
        return row;
      }),
    );
  }

  function renderServiceSelect() {
    el.service.replaceChildren(
      ...rssServices.map((service) => {
        const option = document.createElement("option");
        option.value = service;
        option.textContent = label(service);
        option.selected = service === currentService;
        return option;
      }),
    );
  }

  function keywordChip(feed, keyword) {
    const chip = document.createElement("span");
    chip.className = "keyword-chip";
    chip.append(keyword);
    const remove = document.createElement("button");
    remove.type = "button";
    makeIconButton(remove, "close", `${keyword} を削除`);
    remove.classList.add("is-small");
    remove.addEventListener("click", () => {
      feed.keywords = (feed.keywords || []).filter((word) => word !== keyword);
      renderFeeds();
      updateSaveBar();
    });
    chip.append(remove);
    return chip;
  }

  function textInput(labelText, value, type, onChange) {
    const wrapper = document.createElement("label");
    wrapper.className = "settings-field";
    wrapper.append(labelText);
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.maxLength = type === "url" ? 500 : 80;
    input.addEventListener("input", () => {
      onChange(input.value);
      updateSaveBar();
    });
    wrapper.append(input);
    return wrapper;
  }

  function renderFeeds() {
    const rss = working.rss[currentService];
    el.limit.value = String(rss.max_entries_per_feed);
    el.feedList.replaceChildren(
      ...rss.feeds.map((feed, index) => {
        const card = document.createElement("div");
        card.className = "feed-card";
        const fields = document.createElement("div");
        fields.className = "feed-fields";
        fields.append(
          textInput("表示名", feed.feed_name_display, "text", (value) => {
            feed.feed_name_display = value;
          }),
          textInput("RSS の URL", feed.url, "url", (value) => {
            feed.url = value;
          }),
        );
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger-button";
        makeIconButton(remove, "trash", "このフィードを削除");
        remove.disabled = rss.feeds.length <= 1;
        if (remove.disabled) {
          remove.title = "フィードは 1 つ以上必要です";
        }
        remove.addEventListener("click", () => {
          rss.feeds.splice(index, 1);
          renderFeeds();
          updateSaveBar();
        });
        fields.append(remove);

        const words = document.createElement("div");
        words.className = "keyword-list";
        const caption = document.createElement("span");
        caption.className = "keyword-caption";
        caption.textContent = "キーワード";
        words.append(caption, ...(feed.keywords || []).map((keyword) => keywordChip(feed, keyword)));
        if (!feed.keywords || feed.keywords.length === 0) {
          const none = document.createElement("span");
          none.className = "keyword-none";
          none.textContent = "なし(すべての記事を要約)";
          words.append(none);
        }
        const add = document.createElement("input");
        add.type = "text";
        add.className = "keyword-input";
        add.placeholder = "+ キーワードを追加(Enter)";
        add.maxLength = 60;
        add.setAttribute("aria-label", `${feed.feed_name_display} にキーワードを追加`);
        add.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || event.isComposing) {
            return;
          }
          event.preventDefault();
          const word = add.value.trim();
          if (word && !(feed.keywords || []).includes(word)) {
            feed.keywords = [...(feed.keywords || []), word];
            renderFeeds();
            updateSaveBar();
            el.feedList.querySelectorAll(".keyword-input")[index]?.focus();
          }
        });
        words.append(add);
        card.append(fields, words);
        return card;
      }),
    );
  }

  function render() {
    renderCollectors();
    renderServiceSelect();
    renderFeeds();
    updateSaveBar();
  }

  el.service.addEventListener("change", () => {
    currentService = el.service.value;
    renderFeeds();
  });
  el.limit.addEventListener("input", () => {
    working.rss[currentService].max_entries_per_feed = Number(el.limit.value);
    updateSaveBar();
  });
  el.reset.addEventListener("click", () => {
    working.rss[currentService] = clone(defaults.rss[currentService]);
    renderFeeds();
    updateSaveBar();
  });
  el.addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const rss = working.rss[currentService];
    const url = el.addUrl.value.trim();
    const name = el.addName.value.trim();
    if (!url || !name) {
      return;
    }
    if (rss.feeds.some((feed) => feed.url === url)) {
      updateSaveBar("同じ URL のフィードがすでにあります。");
      return;
    }
    rss.feeds.push({
      name: feedIdFrom(url, new Set(rss.feeds.map((feed) => feed.name))),
      feed_name_display: name,
      url,
      keywords: null,
    });
    el.addForm.reset();
    renderFeeds();
    updateSaveBar();
  });
  el.cancel.addEventListener("click", () => {
    working = JSON.parse(baseline);
    render();
  });
  el.submit.addEventListener("click", async () => {
    el.submit.disabled = true;
    el.saveMessage.textContent = "保存しています…";
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSettingsPayload(working, defaults, rssServices)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || `保存できませんでした(${response.status})`);
      }
      baseline = JSON.stringify(working);
      updateSaveBar("保存しました。次回の収集から使われます。");
    } catch (error) {
      el.submit.disabled = false;
      el.saveMessage.textContent = error instanceof Error ? error.message : "保存できませんでした。";
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (isDirty()) {
      event.preventDefault();
    }
  });

  render();
}

if (typeof window !== "undefined") {
  window.__nookSettingsTestHooks = { buildSettingsPayload, feedIdFrom, normalizeFeeds };
  document.addEventListener("DOMContentLoaded", startSettings);
}
