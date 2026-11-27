// 演習パネル(#19 添削、#20 ケーススタディ)。やり取りは D1 の ai_sessions に残し、
// 学習カレンダー(#21)から見返せるようにする。
import { UpstreamError } from "./chat";
import { readMarkdownRecord, resolveArticleStates } from "./content";
import { type FetchFn, HttpError } from "./env";
import { generateJson } from "./study";

export const MIN_SUMMARY_CHARS = 20;
export const MAX_SUMMARY_CHARS = 3000;
const MAX_ARTICLE_CHARS = 20_000;

export type PracticeSession = {
  id: number;
  kind: string;
  app: string | null;
  day: string | null;
  articleId: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  createdAt: string;
};

type SessionRow = {
  id: number;
  kind: string;
  app: string | null;
  day: string | null;
  article_id: string | null;
  input: string;
  output: string;
  created_at: string;
};

function fromRow(row: SessionRow): PracticeSession {
  return {
    id: row.id,
    kind: row.kind,
    app: row.app,
    day: row.day,
    articleId: row.article_id,
    input: JSON.parse(row.input),
    output: JSON.parse(row.output),
    createdAt: row.created_at,
  };
}

export function sessionToState(session: PracticeSession) {
  return {
    id: session.id,
    kind: session.kind,
    app: session.app,
    date: session.day,
    article_id: session.articleId,
    input: session.input,
    output: session.output,
    created_at: session.createdAt,
  };
}

export async function listSessionsForArticle(
  db: D1Database,
  app: string,
  day: string,
  articleId: string,
): Promise<PracticeSession[]> {
  const { results } = await db
    .prepare("SELECT * FROM ai_sessions WHERE app = ? AND day = ? AND article_id = ? ORDER BY created_at DESC")
    .bind(app, day, articleId)
    .all<SessionRow>();
  return results.map(fromRow);
}

export async function saveSession(
  db: D1Database,
  session: Omit<PracticeSession, "id">,
): Promise<PracticeSession> {
  const row = await db
    .prepare(
      `INSERT INTO ai_sessions (kind, app, day, article_id, input, output, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      session.kind,
      session.app,
      session.day,
      session.articleId,
      JSON.stringify(session.input),
      JSON.stringify(session.output),
      session.createdAt,
    )
    .first<SessionRow>();
  if (!row) {
    throw new Error("ai_sessions への書き込みが行を返しませんでした");
  }
  return fromRow(row);
}

/** 記事を R2 から読む(演習の材料。クライアントから本文は受け取らない)。 */
export async function loadArticleMarkdown(bucket: R2Bucket, app: string, day: string, articleId: string): Promise<string> {
  const record = await readMarkdownRecord(bucket, app, day);
  if (record === null) {
    throw new HttpError(404, "Markdown content not found");
  }
  const states = await resolveArticleStates(bucket, app, day, record.content);
  const article = states.find((state) => state.articleId === articleId);
  if (!article) {
    throw new HttpError(404, "Article not found");
  }
  return article.markdown;
}

export function parseSummary(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "要約を入力してください");
  }
  const summary = value.trim();
  if (summary.length < MIN_SUMMARY_CHARS) {
    throw new HttpError(400, `要約は ${MIN_SUMMARY_CHARS} 字以上で書いてください`);
  }
  if (summary.length > MAX_SUMMARY_CHARS) {
    throw new HttpError(400, `要約は ${MAX_SUMMARY_CHARS} 字以内にしてください`);
  }
  return summary;
}

/** 文字列の配列を取り出す。形が違えば UpstreamError。 */
export function stringList(value: unknown, field: string, max = 6): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new UpstreamError(`${field} の出力の形式が正しくありません`);
  }
  return value
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max)
    .map((item) => item.slice(0, 600));
}

const STRING_LIST = { type: "ARRAY", items: { type: "STRING" } };

const REVIEW_SCHEMA = {
  type: "OBJECT",
  properties: { understood: STRING_LIST, gaps: STRING_LIST, extras: STRING_LIST },
  required: ["understood", "gaps", "extras"],
};

export type ReviewOutput = { understood: string[]; gaps: string[]; extras: string[] };

export function buildReviewPrompt(markdown: string, summary: string): string {
  return `あなたは技術記事の学習を手伝う先生です。学習者が次の記事を読んで書いた要約を添削してください。
日本語で、次の 3 つを箇条書きの文字列の配列で返してください。
- understood: 記事を正しく理解できている点(1〜4 個)。要約のどの部分が記事のどこと合っているかが分かるように
- gaps: 記事とずれている点、誤解、抜けている重要な点(0〜4 個)。記事の内容を根拠に、どう直せばよいかも書く。ずれがなければ空の配列
- extras: 理解をさらに深めるための補足(1〜3 個)。記事に書かれていない一般的な知識を足すときは、記事の外の話だと分かるように書く
学習者を励ます口調で、ただし誤りははっきり指摘してください。

[記事]

${markdown.slice(0, MAX_ARTICLE_CHARS)}

[学習者の要約]

${summary}`;
}

export async function reviewSummary(args: {
  markdown: string;
  summary: string;
  apiKey: string;
  llmModel: string;
  fetchFn: FetchFn;
}): Promise<ReviewOutput> {
  const parsed = (await generateJson({
    prompt: buildReviewPrompt(args.markdown, args.summary),
    schema: REVIEW_SCHEMA,
    apiKey: args.apiKey,
    llmModel: args.llmModel,
    fetchFn: args.fetchFn,
  })) as Record<string, unknown>;
  const output = {
    understood: stringList(parsed?.understood, "understood", 4),
    gaps: stringList(parsed?.gaps, "gaps", 4),
    extras: stringList(parsed?.extras, "extras", 3),
  };
  if (output.understood.length === 0 && output.gaps.length === 0) {
    throw new UpstreamError("添削の出力が空でした");
  }
  return output;
}
