// 閲覧履歴(#73)。D1 の reading_history テーブル(migrations/0004)に、詳細画面で開いた記事を残す。
// 題名・出典・サムネイルはクライアントから受け取らず、サーバーが R2 の記事から読む。
import { readMarkdownRecord, resolveArticleStates } from "./content";
import { HttpError } from "./env";
import { extractSourceLink, extractThumbnail } from "./render";

/** 履歴画面に出す件数の上限。 */
export const MAX_LISTED_HISTORY = 300;
/** これより前に開いた記事の履歴は消す(R2 の記事と同じ寿命)。 */
export const HISTORY_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export type HistoryEntry = {
  app: string;
  day: string;
  articleId: string;
  title: string;
  source: string | null;
  image: string | null;
  firstViewedAt: string;
  lastViewedAt: string;
  viewCount: number;
};

type HistoryRow = {
  app: string;
  day: string;
  article_id: string;
  title: string;
  source: string | null;
  image: string | null;
  first_viewed_at: string;
  last_viewed_at: string;
  view_count: number;
};

function fromRow(row: HistoryRow): HistoryEntry {
  return {
    app: row.app,
    day: row.day,
    articleId: row.article_id,
    title: row.title,
    source: row.source,
    image: row.image,
    firstViewedAt: row.first_viewed_at,
    lastViewedAt: row.last_viewed_at,
    viewCount: row.view_count,
  };
}

export async function listHistory(db: D1Database, limit = MAX_LISTED_HISTORY): Promise<HistoryEntry[]> {
  const { results } = await db
    .prepare("SELECT * FROM reading_history ORDER BY last_viewed_at DESC LIMIT ?")
    .bind(limit)
    .all<HistoryRow>();
  return results.map(fromRow);
}

/** 開いた記事を記録する。同じ記事なら最後に開いた日時と回数だけを更新し、古い履歴を消す。 */
export async function recordView(args: {
  db: D1Database;
  bucket: R2Bucket;
  app: string;
  day: string;
  articleId: string;
  now: Date;
}): Promise<void> {
  const record = await readMarkdownRecord(args.bucket, args.app, args.day);
  if (record === null) {
    throw new HttpError(404, "Markdown content not found");
  }
  const states = await resolveArticleStates(args.bucket, args.app, args.day, record.content);
  const article = states.find((state) => state.articleId === args.articleId);
  if (!article) {
    throw new HttpError(404, "Article not found");
  }
  const viewedAt = args.now.toISOString();
  const cutoff = new Date(args.now.getTime() - HISTORY_RETENTION_DAYS * DAY_MS).toISOString();
  await args.db.batch([
    args.db
      .prepare(
        `INSERT INTO reading_history (app, day, article_id, title, source, image, first_viewed_at, last_viewed_at, view_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (app, day, article_id) DO UPDATE SET
           title = excluded.title,
           source = excluded.source,
           image = excluded.image,
           last_viewed_at = excluded.last_viewed_at,
           view_count = reading_history.view_count + 1`,
      )
      .bind(
        args.app,
        args.day,
        article.articleId,
        article.title,
        extractSourceLink(article.markdown).source,
        extractThumbnail(article.markdown).image,
        viewedAt,
        viewedAt,
      ),
    args.db.prepare("DELETE FROM reading_history WHERE last_viewed_at < ?").bind(cutoff),
  ]);
}

export async function removeHistoryEntry(db: D1Database, app: string, day: string, articleId: string): Promise<void> {
  await db
    .prepare("DELETE FROM reading_history WHERE app = ? AND day = ? AND article_id = ?")
    .bind(app, day, articleId)
    .run();
}

export async function clearHistory(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM reading_history").run();
}
