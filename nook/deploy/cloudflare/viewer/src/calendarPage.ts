// 学習カレンダーの画面(#21)。月のカレンダーに AI に相談した日と回数を出し、日付を押すとその日のやり取りを見返す。
import type { CalendarStats, DayCount, DaySession } from "./calendar";
import { shiftMonth } from "./calendar";
import { displayLabel, type TabInfo, tabMeta } from "./content";
import { ICON_URL, icon } from "./icons";
import { readPath, renderMenu } from "./menu";
import { formatDayLabel } from "./page";
import { escapeHtml } from "./render";

export const CALENDAR_SHELL = { scripts: ["menu.js"], bodyAttributes: 'class="calendar-page"' };

const WEEKDAY_HEADERS = ["日", "月", "火", "水", "木", "金", "土"];

function calendarPath(month: string, day?: string): string {
  const params = new URLSearchParams({ month });
  if (day) {
    params.set("day", day);
  }
  return `/calendar?${params.toString()}`;
}

function monthGrid(args: { month: string; counts: Map<string, number>; today: string; selected: string | null }): string {
  const [year, monthNumber] = args.month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells: string[] = Array.from({ length: first.getUTCDay() }, () => '<span class="cal-cell is-blank"></span>');
  for (let date = 1; date <= daysInMonth; date += 1) {
    const day = `${args.month}-${String(date).padStart(2, "0")}`;
    const count = args.counts.get(day) ?? 0;
    const classes = ["cal-cell", count ? "is-active" : "", day === args.today ? "is-today" : "", day === args.selected ? "is-selected" : ""]
      .filter(Boolean)
      .join(" ");
    const label = `${formatDayLabel(day)}${count ? `、${count} 回` : ""}`;
    cells.push(
      `<a class="${classes}" href="${escapeHtml(calendarPath(args.month, day))}" aria-label="${escapeHtml(label)}"${day === args.selected ? ' aria-current="date"' : ""}><span class="cal-date">${date}</span>${count ? `<span class="cal-count">${count}</span>` : ""}</a>`,
    );
  }
  const headers = WEEKDAY_HEADERS.map((name) => `<span class="cal-weekday">${name}</span>`).join("");
  return `<div class="cal-grid" role="group" aria-label="${year}年${monthNumber}月">${headers}${cells.join("")}</div>`;
}

function list(items: unknown, className: string): string {
  const values = Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
  return values.length
    ? `<ul class="${className}">${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : '<ul class="review-items is-empty"><li>特になし</li></ul>';
}

function sessionCard(session: DaySession, today: string): string {
  const time = new Date(session.created_at).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
  const title = session.title ?? "(記事は保存期間を過ぎて表示できません)";
  const link =
    session.app && session.date && session.article_id && session.title
      ? `<a class="text-button" href="${escapeHtml(readPath(session.app, session.date, today, session.article_id))}">記事の学習画面に戻る</a>`
      : "";
  const input = session.input as Record<string, unknown>;
  const output = session.output as Record<string, unknown>;
  const body =
    session.kind === "review"
      ? `<p class="history-input">${escapeHtml(String(input.summary ?? ""))}</p>
          <div class="review-output">
            <div class="review-box is-good"><h4>正しく理解できている点</h4>${list(output.understood, "review-items")}</div>
            <div class="review-box is-gap"><h4>ずれている点</h4>${list(output.gaps, "review-items")}</div>
            <div class="review-box is-extra"><h4>さらに深める補足</h4>${list(output.extras, "review-items")}</div>
          </div>`
      : `<div class="case-question"><p class="case-situation">${escapeHtml(String(input.situation ?? ""))}</p><p class="case-ask">問い: ${escapeHtml(String(input.question ?? ""))}</p></div>
          <p class="history-input">回答: ${escapeHtml(String(input.answer ?? ""))}</p>
          <div class="review-output">
            <div class="review-box is-good"><h4>良い判断</h4>${list(output.good_points, "review-items")}</div>
            <div class="review-box is-gap"><h4>見落としやすいリスク</h4>${list(output.risks, "review-items")}</div>
            <div class="review-box is-extra"><h4>模範解答の例</h4><p class="model-answer">${escapeHtml(String(output.model_answer ?? ""))}</p></div>
          </div>`;
  return `      <article class="day-session">
        <div class="day-session-head">
          <span class="source-chip">${escapeHtml(session.kind === "review" ? "要約の添削" : "ケーススタディ")}</span>
          <span class="day-session-time">${escapeHtml(time)}</span>
        </div>
        <h3 class="day-session-title">${escapeHtml(session.label ? `${session.label} · ` : "")}${escapeHtml(title)}</h3>
        ${body}
        ${link}
      </article>`;
}

export function renderCalendarBody(args: {
  month: string;
  today: string;
  days: DayCount[];
  stats: CalendarStats;
  selected: string | null;
  sessions: DaySession[];
  appNames: string[];
}): string {
  const counts = new Map(args.days.map((entry) => [entry.day, entry.count]));
  const [year, monthNumber] = args.month.split("-").map(Number);
  const thisMonth = args.today.slice(0, 7);
  const tabs: TabInfo[] = args.appNames.map((appName) => ({
    appName,
    label: displayLabel(appName),
    ...tabMeta(appName),
    articleCount: -1,
    isActive: false,
  }));
  const dayDetail = args.selected
    ? `    <section class="day-detail" aria-labelledby="day-detail-title">
      <h2 id="day-detail-title">${escapeHtml(formatDayLabel(args.selected))}のやり取り</h2>
${args.sessions.length ? args.sessions.map((session) => sessionCard(session, args.today)).join("\n") : '      <p class="empty-state">この日は AI に相談していません。</p>'}
    </section>`
    : "";
  return `  <header class="topbar">
    <button id="menu-button" class="icon-button" type="button" aria-label="メニューを開く" aria-expanded="false" aria-controls="tab-drawer">${icon("menu")}</button>
    <a class="brand" href="/">
      <img src="${ICON_URL}/svg?seed=nook" alt="" width="26" height="26">
      <span class="brand-name">nook</span>
      <span class="brand-sep" aria-hidden="true">/</span>
      <span class="brand-tab">学習カレンダー</span>
    </a>
    <a id="settings-link" class="icon-button" href="/settings" aria-label="設定" title="設定">${icon("settings")}</a>
  </header>
  <main class="calendar-main">
    <h1 class="page-title">学習カレンダー</h1>
    <p class="practice-note">演習パネルで要約の添削やケーススタディを AI に相談した日に印が付きます。</p>
    <dl class="cal-stats">
      <div><dt>連続</dt><dd>${args.stats.streak} 日</dd></div>
      <div><dt>相談した日</dt><dd>${args.stats.totalDays} 日</dd></div>
      <div><dt>相談した回数</dt><dd>${args.stats.totalSessions} 回</dd></div>
    </dl>
    <div class="cal-nav">
      <a class="icon-button" href="${escapeHtml(calendarPath(shiftMonth(args.month, -1)))}" aria-label="前の月">‹</a>
      <h2 class="cal-month">${year}年${monthNumber}月</h2>
      <a class="icon-button" href="${escapeHtml(calendarPath(shiftMonth(args.month, 1)))}" aria-label="次の月">›</a>
      ${args.month === thisMonth ? "" : `<a class="text-button" href="${escapeHtml(calendarPath(thisMonth))}">今月</a>`}
    </div>
${monthGrid({ month: args.month, counts, today: args.today, selected: args.selected })}
${dayDetail}
  </main>

${renderMenu({ tabs, page: "calendar", day: args.today, today: args.today })}
</body>
</html>
`;
}
