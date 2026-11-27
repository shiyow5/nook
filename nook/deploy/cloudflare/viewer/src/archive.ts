// 過去記事のアーカイブ(#15)。R2 の記事を D1 の archive_articles に写し、検索・絞り込み・タグの集計に使う。
// 索引は Worker の cron(index.ts の scheduled)が毎朝入れ、過去の日も少しずつ埋める。
import { loadViewerPage, readMarkdownRecord } from "./content";
import { HttpError, logEvent } from "./env";
import { leadText } from "./home";
import { decodeEntities, type RenderedArticle } from "./render";

export const ARCHIVE_PAGE_SIZE = 20;
/** R2 の自動削除(90 日)と合わせ、それより前の日は索引に入れに行かない。 */
export const ARCHIVE_DAYS = 90;
/** cron 1 回で埋める過去の日数(Workers の実行時間と subrequest を抑える)。 */
export const BACKFILL_DAYS_PER_RUN = 6;
const MAX_BODY_CHARS = 4000;
const MAX_TAGS_PER_ARTICLE = 8;
const TAG_SAMPLE_ROWS = 1500;
const TOP_TAGS = 24;

// タグにしない語(よく出るが内容を表さない語)
const STOP_WORDS = new Set(
  [
    "the", "and", "for", "with", "from", "this", "that", "your", "you", "are", "how", "what", "why", "new", "into",
    "its", "via", "using", "use", "based", "towards", "toward", "through", "about", "our", "can", "not", "all",
    "more", "than", "when", "will", "one", "two", "show", "ask", "tell", "hn", "vs", "has", "have", "was", "were",
    "but", "they", "their", "them", "out", "now", "just", "also", "only", "over", "under", "after", "before",
    "where", "which", "who", "while", "most", "less", "many", "much", "some", "any", "each", "every", "other",
    "such", "these", "those", "there", "here", "then", "make", "makes", "made", "get", "gets", "got",
    // collector が本文に入れる見出しやラベル
    "description", "provided", "summary", "stars", "score", "upvotes", "link", "view", "paper", "available",
    "abstract", "approach", "results", "result", "method", "methods", "github", "reddit",
    "について", "ための", "こと", "もの", "よう", "これ", "それ", "ため", "記事", "解説", "紹介", "方法", "場合",
    "今回", "実際", "以下", "可能", "必要", "利用", "使用", "結果", "検証", "まとめ",
  ].map((word) => word.toLowerCase()),
);

/** 題名と要約から、タグの候補になる語を取り出す(英数の語、3 文字以上のカタカナ、2 文字以上の漢字の並び)。 */
export function extractTags(title: string, lead: string): string[] {
  const text = `${title} ${title} ${lead}`;
  const counts = new Map<string, number>();
  const patterns = [/[A-Za-z][A-Za-z0-9+#.-]{1,30}/g, /[ァ-ヴー]{3,20}/g, /[一-龠々]{2,8}/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0].replace(/[.-]+$/, "");
      const word = /^[A-Za-z]/.test(raw) && raw !== raw.toUpperCase() ? raw.toLowerCase() : raw;
      // 小文字の英単語は 3 文字以上だけ(AI や ML のような大文字の略語は 2 文字でも残す)
      const tooShort = /^[a-z]/.test(word) ? word.length < 3 : word.length < 2;
      if (tooShort || STOP_WORDS.has(word.toLowerCase()) || /^\d/.test(word)) {
        continue;
      }
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TAGS_PER_ARTICLE)
    .map(([word]) => word);
}

function plainBody(html: string): string {
  return decodeEntities(html.replace(/<h[1-6]\b[\s\S]*?<\/h[1-6]\s*>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_BODY_CHARS);
}

function archiveStatements(db: D1Database, app: string, day: string, articles: RenderedArticle[]): D1PreparedStatement[] {
  const insert = db.prepare(
    `INSERT INTO archive_articles (app, day, article_id, title, source, link, image, lead, body, tags, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return articles.map((article, position) => {
    const lead = leadText(article.html, 160);
    const tags = extractTags(article.title, lead);
    return insert.bind(
      app,
      day,
      article.articleId,
      article.title,
      article.source,
      article.link,
      article.image,
      lead,
      plainBody(article.html),
      tags.length ? `|${tags.join("|")}|` : "",
      position,
    );
  });
}

/** 1 日分(全タブ)を索引に入れる。Markdown が前回と同じタブは入れ直さない。入れた記事数を返す。 */
export async function indexDay(args: {
  db: D1Database;
  bucket: R2Bucket;
  appNames: string[];
  day: string;
  now: Date;
}): Promise<number> {
  const { results } = await args.db
    .prepare("SELECT app, source_updated_at FROM archive_days WHERE day = ?")
    .bind(args.day)
    .all<{ app: string; source_updated_at: string | null }>();
  const known = new Map(results.map((row) => [row.app, row.source_updated_at]));
  const records = await Promise.all(
    args.appNames.map(async (app) => ({ app, record: await readMarkdownRecord(args.bucket, app, args.day) })),
  );
  const changed = records
    .filter(({ app, record }) => !known.has(app) || known.get(app) !== (record?.updatedAt ?? null))
    .map(({ app }) => app);
  if (changed.length === 0) {
    return 0;
  }
  const page = await loadViewerPage(args.bucket, changed, args.day);
  const statements: D1PreparedStatement[] = [];
  let count = 0;
  for (const app of changed) {
    const articles = page.articles[app] ?? [];
    count += articles.length;
    statements.push(
      args.db.prepare("DELETE FROM archive_articles WHERE app = ? AND day = ?").bind(app, args.day),
      ...archiveStatements(args.db, app, args.day, articles),
      args.db
        .prepare(
          `INSERT INTO archive_days (app, day, source_updated_at, article_count, indexed_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (app, day) DO UPDATE SET source_updated_at = excluded.source_updated_at,
             article_count = excluded.article_count, indexed_at = excluded.indexed_at`,
        )
        .bind(app, args.day, page.markdownUpdatedAt[app] ?? null, articles.length, args.now.toISOString()),
    );
  }
  await args.db.batch(statements);
  return count;
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** cron から呼ぶ。今日と昨日を入れ直し、まだ入れていない過去の日を新しい順に少しずつ埋める。 */
export async function runArchiveIndexing(args: {
  db: D1Database;
  bucket: R2Bucket;
  appNames: string[];
  today: string;
  now: Date;
}): Promise<{ days: string[]; articles: number }> {
  const { results } = await args.db
    .prepare("SELECT DISTINCT day FROM archive_days WHERE day >= ?")
    .bind(shiftDay(args.today, -ARCHIVE_DAYS))
    .all<{ day: string }>();
  const indexed = new Set(results.map((row) => row.day));
  const missing: string[] = [];
  for (let offset = 2; offset <= ARCHIVE_DAYS && missing.length < BACKFILL_DAYS_PER_RUN; offset += 1) {
    const day = shiftDay(args.today, -offset);
    if (!indexed.has(day)) {
      missing.push(day);
    }
  }
  const days = [args.today, shiftDay(args.today, -1), ...missing];
  let articles = 0;
  for (const day of days) {
    articles += await indexDay({ ...args, day });
  }
  logEvent("info", { event: "archive_indexed", days, articles });
  return { days, articles };
}

export type ArchiveQuery = {
  q: string;
  tab: string | null;
  month: string | null;
  tag: string | null;
  order: "new" | "old";
  page: number;
};

export function parseArchiveQuery(url: URL, appNames: string[]): ArchiveQuery {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const tab = url.searchParams.get("tab");
  const month = url.searchParams.get("month");
  const tag = (url.searchParams.get("tag") ?? "").trim().slice(0, 40);
  const page = Number(url.searchParams.get("page") ?? "1");
  if (tab && !appNames.includes(tab)) {
    throw new HttpError(400, "tab が正しくありません");
  }
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpError(400, "month must be YYYY-MM");
  }
  return {
    q,
    tab: tab || null,
    month: month || null,
    tag: tag || null,
    order: url.searchParams.get("order") === "old" ? "old" : "new",
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function whereClause(query: ArchiveQuery): { sql: string; values: string[] } {
  const conditions: string[] = [];
  const values: string[] = [];
  for (const word of query.q.split(/\s+/).filter(Boolean).slice(0, 5)) {
    conditions.push("(title LIKE ? ESCAPE '\\' OR lead LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
    values.push(likePattern(word), likePattern(word), likePattern(word));
  }
  if (query.tab) {
    conditions.push("app = ?");
    values.push(query.tab);
  }
  if (query.month) {
    conditions.push("day LIKE ?");
    values.push(`${query.month}-%`);
  }
  if (query.tag) {
    conditions.push("tags LIKE ? ESCAPE '\\'");
    values.push(likePattern(`|${query.tag}|`));
  }
  return { sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
}

export type ArchiveArticle = {
  app: string;
  day: string;
  articleId: string;
  title: string;
  source: string | null;
  image: string | null;
  lead: string;
  tags: string[];
};

export type ArchiveResult = {
  total: number;
  articles: ArchiveArticle[];
  tags: { tag: string; count: number }[];
  months: string[];
  indexedDays: number;
};

export async function searchArchive(db: D1Database, query: ArchiveQuery): Promise<ArchiveResult> {
  const where = whereClause(query);
  const direction = query.order === "old" ? "ASC" : "DESC";
  const [totalRow, rows, tagRows, monthRows, dayRow] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM archive_articles ${where.sql}`).bind(...where.values).first<{ total: number }>(),
    db
      .prepare(
        `SELECT app, day, article_id, title, source, image, lead, tags FROM archive_articles ${where.sql}
         ORDER BY day ${direction}, app, position LIMIT ? OFFSET ?`,
      )
      .bind(...where.values, ARCHIVE_PAGE_SIZE, (query.page - 1) * ARCHIVE_PAGE_SIZE)
      .all<{ app: string; day: string; article_id: string; title: string; source: string | null; image: string | null; lead: string; tags: string }>(),
    // タグは絞り込んだ結果のうち新しい方から一定数を数える(全件を数えると重いため)
    db
      .prepare(`SELECT tags FROM archive_articles ${where.sql} ORDER BY day DESC LIMIT ?`)
      .bind(...where.values, TAG_SAMPLE_ROWS)
      .all<{ tags: string }>(),
    db.prepare("SELECT DISTINCT substr(day, 1, 7) AS month FROM archive_articles ORDER BY month DESC").all<{ month: string }>(),
    // 記事のない日(収集前や保存期間外)も索引済みとして記録しているので、記事のある日だけを数える
    db.prepare("SELECT COUNT(DISTINCT day) AS days FROM archive_days WHERE article_count > 0").first<{ days: number }>(),
  ]);
  const tagCounts = new Map<string, number>();
  for (const row of tagRows.results) {
    for (const tag of row.tags.split("|").filter(Boolean)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  return {
    total: totalRow?.total ?? 0,
    articles: rows.results.map((row) => ({
      app: row.app,
      day: row.day,
      articleId: row.article_id,
      title: row.title,
      source: row.source,
      image: row.image,
      lead: row.lead,
      tags: row.tags.split("|").filter(Boolean),
    })),
    tags: [...tagCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_TAGS)
      .map(([tag, count]) => ({ tag, count })),
    months: monthRows.results.map((row) => row.month),
    indexedDays: dayRow?.days ?? 0,
  };
}
