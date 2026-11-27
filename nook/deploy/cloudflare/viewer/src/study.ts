// 学びパネル(#40)の「この記事に出てきた言葉」と「理解度チェック」を Gemini の JSON 出力で作る。
import { resolveGeminiModel, UpstreamError } from "./chat";
import type { FetchFn } from "./env";

export type StudyKind = "terms" | "quiz";
export type Term = { word: string; explanation: string };
export type QuizQuestion = { question: string; choices: string[]; answer_index: number; explanation: string };

export const STUDY_KINDS: ReadonlySet<string> = new Set(["terms", "quiz"]);
const MAX_TERMS = 6;
const QUIZ_LENGTH = 3;
const CHOICES = 4;
/** 記事の Markdown はふつう数千字。プロンプトが膨らみすぎないよう上限を置く。 */
const MAX_ARTICLE_CHARS = 20_000;

export function studyCacheKey(appName: string, day: string, articleId: string, kind: StudyKind): string {
  return `_state/study/${appName}/${day}/${articleId}-${kind}.json`;
}

const SCHEMAS: Record<StudyKind, unknown> = {
  terms: {
    type: "OBJECT",
    properties: {
      terms: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { word: { type: "STRING" }, explanation: { type: "STRING" } },
          required: ["word", "explanation"],
        },
      },
    },
    required: ["terms"],
  },
  quiz: {
    type: "OBJECT",
    properties: {
      questions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            question: { type: "STRING" },
            choices: { type: "ARRAY", items: { type: "STRING" } },
            answer_index: { type: "INTEGER" },
            explanation: { type: "STRING" },
          },
          required: ["question", "choices", "answer_index", "explanation"],
        },
      },
    },
    required: ["questions"],
  },
};

const INSTRUCTIONS: Record<StudyKind, string> = {
  terms: `次の記事を学習する人のために、記事に出てくる専門用語を 3〜5 個選び、それぞれ入門者向けに 1〜2 文の日本語で説明してください。
記事を読むうえで前提になる語を優先し、固有の製品名やモデル名だけの語は避けてください。説明は記事の文脈に合わせてください。`,
  quiz: `次の記事の理解度を確かめる 4 択問題を、ちょうど ${QUIZ_LENGTH} 問、日本語で作ってください。
記事の要点(手法、結果、理由)を問い、記事を読めば答えられる問題にしてください。choices は 4 つ、answer_index は正解の位置(0〜3)、explanation は正解の理由を 1〜2 文で書いてください。正解の位置は問題ごとに偏らせないでください。`,
};

export function buildStudyPrompt(kind: StudyKind, markdown: string): string {
  return `${INSTRUCTIONS[kind]}\n\n[記事]\n\n${markdown.slice(0, MAX_ARTICLE_CHARS)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new UpstreamError("学習用の出力の形式が正しくありません");
  }
  return value.trim();
}

export function parseTerms(value: unknown): Term[] {
  if (!isRecord(value) || !Array.isArray(value.terms) || value.terms.length === 0) {
    throw new UpstreamError("用語の出力の形式が正しくありません");
  }
  return value.terms.slice(0, MAX_TERMS).map((term) => {
    if (!isRecord(term)) {
      throw new UpstreamError("用語の出力の形式が正しくありません");
    }
    return { word: nonEmpty(term.word, 60), explanation: nonEmpty(term.explanation, 400) };
  });
}

export function parseQuiz(value: unknown): QuizQuestion[] {
  if (!isRecord(value) || !Array.isArray(value.questions) || value.questions.length < QUIZ_LENGTH) {
    throw new UpstreamError("問題の出力の形式が正しくありません");
  }
  return value.questions.slice(0, QUIZ_LENGTH).map((item) => {
    if (!isRecord(item) || !Array.isArray(item.choices) || item.choices.length !== CHOICES) {
      throw new UpstreamError("問題の出力の形式が正しくありません");
    }
    const answer = item.answer_index;
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer >= CHOICES) {
      throw new UpstreamError("問題の正解の位置が正しくありません");
    }
    return {
      question: nonEmpty(item.question, 400),
      choices: item.choices.map((choice) => nonEmpty(choice, 200)),
      answer_index: answer,
      explanation: nonEmpty(item.explanation, 600),
    };
  });
}

/** Gemini に JSON(responseSchema の形)で答えさせ、解析した値を返す。 */
export async function generateJson(args: {
  prompt: string;
  schema: unknown;
  apiKey: string;
  llmModel: string;
  fetchFn: FetchFn;
}): Promise<unknown> {
  const model = resolveGeminiModel(args.llmModel);
  const response = await args.fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": args.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: args.schema },
      }),
    },
  );
  if (!response.ok) {
    throw new UpstreamError(`Gemini API returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const payload = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (payload.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError("Gemini API returned invalid JSON");
  }
}

export async function generateStudy(args: {
  kind: StudyKind;
  markdown: string;
  apiKey: string;
  llmModel: string;
  fetchFn: FetchFn;
}): Promise<Term[] | QuizQuestion[]> {
  const parsed = await generateJson({
    prompt: buildStudyPrompt(args.kind, args.markdown),
    schema: SCHEMAS[args.kind],
    apiKey: args.apiKey,
    llmModel: args.llmModel,
    fetchFn: args.fetchFn,
  });
  return args.kind === "terms" ? parseTerms(parsed) : parseQuiz(parsed);
}
