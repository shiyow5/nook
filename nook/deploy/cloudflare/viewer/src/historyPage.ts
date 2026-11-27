// 閲覧履歴の画面(#73)。最後に開いた新しい順に、開いた日(日本時間)ごとにまとめて並べる。
import { header, menuTabs } from "./bookmarksPage";
import { displayLabel } from "./content";
import type { HistoryEntry } from "./history";
import { readPath, renderMenu } from "./menu";
import { formatDayLabel, formatShortDayLabel } from "./page";
import { escapeHtml, thumbnailHtml } from "./render";

export const HISTORY_SHELL = { scripts: ["menu.js", "history.js"], bodyAttributes: 'class="history-page"' };

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toJst(iso: string): { day: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString();
  return { day: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

function dayHeading(day: string, today: string): string {
  if (day === today) {
    return "今日";
  }
  if (day === previousDay(today)) {
    return `昨日 · ${formatShortDayLabel(day)}`;
  }
  return formatDayLabel(day);
}

/** 開いた日ごとに分ける。entries は新しい順に並んでいる前提で、順番を保つ。 */
function groupByViewedDay(entries: HistoryEntry[]): Array<{ day: string; entries: HistoryEntry[] }> {
  return entries.reduce<Array<{ day: string; entries: HistoryEntry[] }>>((groups, entry) => {
    const { day } = toJst(entry.lastViewedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      return [...groups.slice(0, -1), { day, entries: [...last.entries, entry] }];
    }
    return [...groups, { day, entries: [entry] }];
  }, []);
}

export function renderHistoryBody(args: { entries: HistoryEntry[]; appNames: string[]; today: string }): string {
  const sections = groupByViewedDay(args.entries)
    .map(
      (group) => `      <section class="history-group">
        <h2 class="history-day">${escapeHtml(dayHeading(group.day, args.today))}</h2>
        <ol class="bookmark-list">
${group.entries.map((entry) => renderHistoryCard(entry, args.today)).join("\n")}
        </ol>
      </section>`,
    )
    .join("\n");
  const count = args.entries.length;
  return `${header("履歴")}
  <main class="bookmarks-main">
    <div class="home-section-head">
      <h1 class="page-title">履歴</h1>
      <span id="history-count" class="home-section-note">${count} 本</span>
      <button id="history-clear" class="text-button history-clear" type="button"${count ? "" : " hidden"}>すべて消す</button>
    </div>
    <p id="history-empty" class="empty-state"${count ? " hidden" : ""}>まだ開いた記事はありません。詳細画面で記事を開くと、ここに並びます。</p>
    <div id="history-list" class="history-list">
${sections}
    </div>
    <p class="bookmark-note">開いてから 90 日たった記事は、履歴から消えます。</p>
  </main>

${renderMenu({ tabs: menuTabs(args.appNames), page: "history", day: args.today, today: args.today })}
</body>
</html>
`;
}

function renderHistoryCard(entry: HistoryEntry, today: string): string {
  const meta = [displayLabel(entry.app), entry.source].filter(Boolean).join(" · ");
  const { time } = toJst(entry.lastViewedAt);
  const views = entry.viewCount > 1 ? ` · ${entry.viewCount} 回目` : "";
  return `          <li class="bookmark-card history-card" data-app-name="${escapeHtml(entry.app)}" data-date="${escapeHtml(entry.day)}" data-article-id="${escapeHtml(entry.articleId)}">
            <a class="bookmark-main" href="${escapeHtml(readPath(entry.app, entry.day, today, entry.articleId))}">
              <span class="row-text">
                <span class="row-source">${escapeHtml(meta)}</span>
                <span class="row-title">${escapeHtml(entry.title)}</span>
                <span class="bookmark-day">${escapeHtml(formatDayLabel(entry.day))}の記事 · ${time}${views}</span>
              </span>
              ${thumbnailHtml(entry.image, "row-thumb")}
            </a>
            <div class="bookmark-actions">
              <button class="text-button history-remove" type="button">履歴から消す</button>
            </div>
          </li>`;
}
