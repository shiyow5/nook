// お気に入り(#14)。D1 の favorites テーブル(migrations/0001)に、本文の写しと一緒に保存する。
// R2 の Markdown は 90 日で消えるので、保存した記事は写しから読めるようにする。
import { readMarkdownRecord, resolveArticleStates } from "./content";
import { HttpError } from "./env";
import { extractSourceLink, extractThumbnail } from "./render";

/** ブックマーク画面に出す件数の上限。 */
export const MAX_LISTED_FAVORITES = 200;

export type Favorite = {
  app: string;
  day: string;
  articleId: string;
  title: string;
  source: string | null;
  link: string | null;
  image: string | null;
  markdown: string;
  createdAt: string;
};

type FavoriteRow = {
  app: string;
  day: string;
  article_id: string;
  title: string;
  source: string | null;
  link: string | null;
  image: string | null;
  markdown: string;
  created_at: string;
};

function fromRow(row: FavoriteRow): Favorite {
  return {
    app: row.app,
    day: row.day,
    articleId: row.article_id,
    title: row.title,
    source: row.source,
    link: row.link,
    image: row.image,
    markdown: row.markdown,
    createdAt: row.created_at,
  };
}

export async function listFavorites(db: D1Database, limit = MAX_LISTED_FAVORITES): Promise<Favorite[]> {
  const { results } = await db
    .prepare("SELECT * FROM favorites ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all<FavoriteRow>();
  return results.map(fromRow);
}

/** その日に保存した記事の ID を、タブごとにまとめて返す(詳細画面のボタンの初期状態に使う)。 */
export async function favoriteIdsForDay(db: D1Database, day: string): Promise<Record<string, string[]>> {
  const { results } = await db
    .prepare("SELECT app, article_id FROM favorites WHERE day = ?")
    .bind(day)
    .all<{ app: string; article_id: string }>();
  const grouped: Record<string, string[]> = {};
  for (const row of results) {
    grouped[row.app] = [...(grouped[row.app] ?? []), row.article_id];
  }
  return grouped;
}

/**
 * 記事を R2 から探して保存する。本文はクライアントから受け取らず、サーバーが読んだものを写す。
 * すでに保存済みなら何もしない。
 */
export async function addFavorite(args: {
  db: D1Database;
  bucket: R2Bucket;
  app: string;
  day: string;
  articleId: string;
  now: Date;
}): Promise<Favorite> {
  const record = await readMarkdownRecord(args.bucket, args.app, args.day);
  if (record === null) {
    throw new HttpError(404, "Markdown content not found");
  }
  const states = await resolveArticleStates(args.bucket, args.app, args.day, record.content);
  const article = states.find((state) => state.articleId === args.articleId);
  if (!article) {
    throw new HttpError(404, "Article not found");
  }
  const { source, link } = extractSourceLink(article.markdown);
  const favorite: Favorite = {
    app: args.app,
    day: args.day,
    articleId: article.articleId,
    title: article.title,
    source,
    link,
    image: extractThumbnail(article.markdown).image,
    markdown: article.markdown,
    createdAt: args.now.toISOString(),
  };
  await args.db
    .prepare(
      `INSERT INTO favorites (app, day, article_id, title, source, link, image, markdown, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (app, day, article_id) DO NOTHING`,
    )
    .bind(
      favorite.app,
      favorite.day,
      favorite.articleId,
      favorite.title,
      favorite.source,
      favorite.link,
      favorite.image,
      favorite.markdown,
      favorite.createdAt,
    )
    .run();
  return favorite;
}

export async function removeFavorite(db: D1Database, app: string, day: string, articleId: string): Promise<void> {
  await db
    .prepare("DELETE FROM favorites WHERE app = ? AND day = ? AND article_id = ?")
    .bind(app, day, articleId)
    .run();
}

export async function getFavorite(
  db: D1Database,
  app: string,
  day: string,
  articleId: string,
): Promise<Favorite | null> {
  const row = await db
    .prepare("SELECT * FROM favorites WHERE app = ? AND day = ? AND article_id = ?")
    .bind(app, day, articleId)
    .first<FavoriteRow>();
  return row ? fromRow(row) : null;
}
