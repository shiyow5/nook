// 用語辞書(#17)。D1 の terms テーブル(migrations/0001, 0002)を読み書きする。
// 学びパネルの用語カードや記事中の選択(#16)からも、ここを通して登録する。
import { UpstreamError } from "./chat";
import { type FetchFn, HttpError } from "./env";
import { generateJson } from "./study";

export const TERM_STATUSES = ["learning", "understood"] as const;
export type TermStatus = (typeof TERM_STATUSES)[number];

const LIMITS = { word: 80, reading: 80, explanation: 1000, note: 2000 } as const;

export type GlossaryTerm = {
  id: number;
  word: string;
  reading: string | null;
  explanation: string;
  note: string | null;
  important: boolean;
  status: TermStatus;
  app: string | null;
  day: string | null;
  articleId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TermInput = {
  word: string;
  explanation: string;
  reading: string | null;
  note: string | null;
  important: boolean;
  status: TermStatus;
  app: string | null;
  day: string | null;
  articleId: string | null;
};

type TermRow = {
  id: number;
  word: string;
  reading: string | null;
  explanation: string;
  note: string | null;
  important: number;
  status: TermStatus;
  app: string | null;
  day: string | null;
  article_id: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: TermRow): GlossaryTerm {
  return {
    id: row.id,
    word: row.word,
    reading: row.reading,
    explanation: row.explanation,
    note: row.note,
    important: row.important === 1,
    status: row.status,
    app: row.app,
    day: row.day,
    articleId: row.article_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function termToState(term: GlossaryTerm) {
  return {
    id: term.id,
    word: term.word,
    reading: term.reading,
    explanation: term.explanation,
    note: term.note,
    important: term.important,
    status: term.status,
    app: term.app,
    date: term.day,
    article_id: term.articleId,
    created_at: term.createdAt,
    updated_at: term.updatedAt,
  };
}

function text(value: unknown, field: keyof typeof LIMITS, required: boolean): string | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim() && !required)) {
    if (required) {
      throw new HttpError(400, `${field} を入力してください`);
    }
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} を入力してください`);
  }
  if (value.length > LIMITS[field]) {
    throw new HttpError(400, `${field} は ${LIMITS[field]} 字以内にしてください`);
  }
  return value.trim();
}

function optionalId(value: unknown, pattern: RegExp, field: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new HttpError(400, `${field} の形式が正しくありません`);
  }
  return value;
}

/** 新規登録の入力を検証する。出典(app / date / article_id)は任意。 */
export function parseTermInput(payload: unknown): TermInput {
  const record = (payload ?? {}) as Record<string, unknown>;
  const status = record.status ?? "learning";
  if (!TERM_STATUSES.includes(status as TermStatus)) {
    throw new HttpError(400, "status は learning か understood にしてください");
  }
  if (record.important !== undefined && typeof record.important !== "boolean") {
    throw new HttpError(400, "important は true か false にしてください");
  }
  return {
    word: text(record.word, "word", true) as string,
    explanation: text(record.explanation, "explanation", true) as string,
    reading: text(record.reading, "reading", false),
    note: text(record.note, "note", false),
    important: record.important === true,
    status: status as TermStatus,
    app: optionalId(record.app, /^[a-z_]{1,40}$/, "app"),
    day: optionalId(record.date, /^\d{4}-\d{2}-\d{2}$/, "date"),
    articleId: optionalId(record.article_id, /^[\w-]{1,120}$/, "article_id"),
  };
}

/** 一部だけの更新。送られた項目だけを書き換える。 */
export function parseTermPatch(payload: unknown): Partial<TermInput> {
  const record = (payload ?? {}) as Record<string, unknown>;
  const patch: Partial<TermInput> = {};
  if ("word" in record) patch.word = text(record.word, "word", true) as string;
  if ("explanation" in record) patch.explanation = text(record.explanation, "explanation", true) as string;
  if ("reading" in record) patch.reading = text(record.reading, "reading", false);
  if ("note" in record) patch.note = text(record.note, "note", false);
  if ("important" in record) {
    if (typeof record.important !== "boolean") {
      throw new HttpError(400, "important は true か false にしてください");
    }
    patch.important = record.important;
  }
  if ("status" in record) {
    if (!TERM_STATUSES.includes(record.status as TermStatus)) {
      throw new HttpError(400, "status は learning か understood にしてください");
    }
    patch.status = record.status as TermStatus;
  }
  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, "変更する項目がありません");
  }
  return patch;
}

export async function listTerms(db: D1Database): Promise<GlossaryTerm[]> {
  const { results } = await db.prepare("SELECT * FROM terms ORDER BY created_at DESC").all<TermRow>();
  return results.map(fromRow);
}

/** 同じ語(大文字と小文字は区別しない)がすでにあれば、説明と出典を残したまま重要・メモだけを足す。 */
export async function addTerm(db: D1Database, input: TermInput, now: Date): Promise<GlossaryTerm> {
  const timestamp = now.toISOString();
  const row = await db
    .prepare(
      `INSERT INTO terms (word, reading, explanation, note, important, status, app, day, article_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (word) DO UPDATE SET
         important = MAX(terms.important, excluded.important),
         note = COALESCE(terms.note, excluded.note),
         reading = COALESCE(terms.reading, excluded.reading),
         updated_at = excluded.updated_at
       RETURNING *`,
    )
    .bind(
      input.word,
      input.reading,
      input.explanation,
      input.note,
      input.important ? 1 : 0,
      input.status,
      input.app,
      input.day,
      input.articleId,
      timestamp,
      timestamp,
    )
    .first<TermRow>();
  if (!row) {
    throw new Error("terms への書き込みが行を返しませんでした");
  }
  return fromRow(row);
}

const PATCH_COLUMNS: Record<keyof TermInput, string> = {
  word: "word",
  explanation: "explanation",
  reading: "reading",
  note: "note",
  important: "important",
  status: "status",
  app: "app",
  day: "day",
  articleId: "article_id",
};

export async function updateTerm(
  db: D1Database,
  id: number,
  patch: Partial<TermInput>,
  now: Date,
): Promise<GlossaryTerm> {
  const entries = Object.entries(patch) as [keyof TermInput, TermInput[keyof TermInput]][];
  const assignments = entries.map(([key]) => `${PATCH_COLUMNS[key]} = ?`).join(", ");
  const values = entries.map(([, value]) => (typeof value === "boolean" ? (value ? 1 : 0) : value));
  try {
    const row = await db
      .prepare(`UPDATE terms SET ${assignments}, updated_at = ? WHERE id = ? RETURNING *`)
      .bind(...values, now.toISOString(), id)
      .first<TermRow>();
    if (!row) {
      throw new HttpError(404, "Term not found");
    }
    return fromRow(row);
  } catch (error) {
    if (error instanceof Error && /UNIQUE/.test(error.message)) {
      throw new HttpError(409, "同じ語がすでに辞書にあります");
    }
    throw error;
  }
}

export async function deleteTerm(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM terms WHERE id = ?").bind(id).run();
}

const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: { reading: { type: "STRING" }, explanation: { type: "STRING" } },
  required: ["reading", "explanation"],
};

export function glossaryDraftKey(word: string): string {
  return `_state/glossary_drafts/${encodeURIComponent(word.trim().toLowerCase())}.json`;
}

/** 用語の読みと入門者向けの説明を LLM に下書きさせる。結果は R2 に残し、同じ語では呼ばない。 */
export async function draftTerm(args: {
  word: string;
  bucket: R2Bucket;
  apiKey: string;
  llmModel: string;
  fetchFn: FetchFn;
}): Promise<{ reading: string; explanation: string }> {
  const key = glossaryDraftKey(args.word);
  const cached = await args.bucket.get(key);
  if (cached !== null) {
    return JSON.parse(await cached.text());
  }
  const parsed = (await generateJson({
    prompt: `IT・AI の技術用語「${args.word}」について、読み(ひらがな。英字の略語は「えーぴーあい」のような読み)と、入門者向けの 2〜3 文の日本語の説明を書いてください。説明には、何のための技術か、似た語との違いがあればそれも含めてください。`,
    schema: DRAFT_SCHEMA,
    apiKey: args.apiKey,
    llmModel: args.llmModel,
    fetchFn: args.fetchFn,
  })) as Record<string, unknown>;
  const reading = typeof parsed?.reading === "string" ? parsed.reading.trim().slice(0, LIMITS.reading) : "";
  const explanation =
    typeof parsed?.explanation === "string" ? parsed.explanation.trim().slice(0, LIMITS.explanation) : "";
  if (!explanation) {
    throw new UpstreamError("用語の下書きの形式が正しくありません");
  }
  const draft = { reading, explanation };
  await args.bucket.put(key, JSON.stringify(draft), { httpMetadata: { contentType: "application/json" } });
  return draft;
}
