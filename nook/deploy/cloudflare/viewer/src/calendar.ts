// 学習カレンダー(#21)。添削(#19)とケーススタディ(#20)で AI に相談した日を、日本時間で数える。
import { displayLabel, readMarkdownRecord, resolveArticleStates } from "./content";
import { HttpError } from "./env";
import { type PracticeSession, sessionToState } from "./practice";

export type DayCount = { day: string; count: number };

export type CalendarStats = { totalDays: number; totalSessions: number; streak: number };

/** created_at(UTC の ISO 文字列)を日本時間の日付に直す SQL 式。 */
const JST_DAY = "date(created_at, '+9 hours')";

export function parseMonth(value: string | null, today: string): string {
  if (value === null) {
    return today.slice(0, 7);
  }
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new HttpError(400, "month must be YYYY-MM");
  }
  return value;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export async function countByDay(db: D1Database): Promise<DayCount[]> {
  const { results } = await db
    .prepare(
      // ai_sessions には記事の日付の列 day があるので、別名は jst_day にして取り違えない
      `SELECT ${JST_DAY} AS jst_day, COUNT(*) AS count FROM ai_sessions
       WHERE kind IN ('review', 'case') GROUP BY jst_day ORDER BY jst_day`,
    )
    .all<{ jst_day: string; count: number }>();
  return results.map((row) => ({ day: row.jst_day, count: row.count }));
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** 連続日数は、今日か昨日から途切れずに続いている日数(今日まだ相談していなくても切らない)。 */
export function computeStats(days: DayCount[], today: string): CalendarStats {
  const active = new Set(days.filter((entry) => entry.count > 0).map((entry) => entry.day));
  let cursor = active.has(today) ? today : previousDay(today);
  let streak = 0;
  while (active.has(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  return {
    totalDays: active.size,
    totalSessions: days.reduce((sum, entry) => sum + entry.count, 0),
    streak,
  };
}

export type DaySession = ReturnType<typeof sessionToState> & { title: string | null; label: string };

/** その日(日本時間)のやり取りを、記事の題名と一緒に返す。記事が R2 から消えていれば題名は null。 */
export async function sessionsOnDay(db: D1Database, bucket: R2Bucket, day: string): Promise<DaySession[]> {
  const { results } = await db
    .prepare(`SELECT * FROM ai_sessions WHERE kind IN ('review', 'case') AND ${JST_DAY} = ? ORDER BY created_at`)
    .bind(day)
    .all<{
      id: number;
      kind: string;
      app: string | null;
      day: string | null;
      article_id: string | null;
      input: string;
      output: string;
      created_at: string;
    }>();
  const sessions: PracticeSession[] = results.map((row) => ({
    id: row.id,
    kind: row.kind,
    app: row.app,
    day: row.day,
    articleId: row.article_id,
    input: JSON.parse(row.input),
    output: JSON.parse(row.output),
    createdAt: row.created_at,
  }));
  const titles = new Map<string, Map<string, string>>();
  for (const pair of new Set(sessions.filter((s) => s.app && s.day).map((s) => `${s.app}/${s.day}`))) {
    const [app, articleDay] = pair.split("/");
    const record = await readMarkdownRecord(bucket, app, articleDay);
    const states = record ? await resolveArticleStates(bucket, app, articleDay, record.content) : [];
    titles.set(pair, new Map(states.map((state) => [state.articleId, state.title])));
  }
  return sessions.map((session) => ({
    ...sessionToState(session),
    title: titles.get(`${session.app}/${session.day}`)?.get(session.articleId ?? "") ?? null,
    label: session.app ? displayLabel(session.app) : "",
  }));
}
