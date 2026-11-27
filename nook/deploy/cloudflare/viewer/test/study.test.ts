import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { type AppDeps, handleRequest } from "../src/app";
import { parseQuiz, parseTerms, studyCacheKey } from "../src/study";

const DAY = "2026-11-27";
const MARKDOWN = "# KV キャッシュの圧縮\n\n[View on Zenn](https://zenn.dev/a)\n\nKV キャッシュを量子化してメモリを減らす。";
const GEMINI = "https://generativelanguage.googleapis.com/";

const TERMS = { terms: [{ word: "KV キャッシュ", explanation: "生成済みトークンの Key と Value を保存する仕組み。" }] };
const QUIZ = {
  questions: [1, 2, 3].map((n) => ({
    question: `問題 ${n}`,
    choices: ["ア", "イ", "ウ", "エ"],
    answer_index: n % 4,
    explanation: `解説 ${n}`,
  })),
};

function geminiReply(payload: unknown): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
}

function buildDeps(reply: () => Response) {
  const calls: { url: string; body: string }[] = [];
  const deps: AppDeps = {
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, body: String(init?.body ?? "") });
      return url.startsWith(GEMINI) ? reply() : new Response("not found", { status: 404 });
    },
    verifyAccess: async () => true,
    now: () => new Date("2026-11-27T03:00:00Z"),
  };
  return { deps, calls };
}

const testEnv = () => ({ ...env, GOOGLE_API_KEY: "k", GITHUB_TOKEN: "t" });

async function articleId(): Promise<string> {
  const response = await handleRequest(
    new Request(`https://nook-viewer.example.workers.dev/api/markdown/jp_tech_news?date=${DAY}`),
    testEnv(),
    buildDeps(() => new Response("unused")).deps,
  );
  return ((await response.json()) as { articles: { article_id: string }[] }).articles[0].article_id;
}

function post(body: unknown, origin = "https://nook-viewer.example.workers.dev"): Request {
  return new Request("https://nook-viewer.example.workers.dev/api/study/jp_tech_news", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await env.NOOK_BUCKET.put(`jp_tech_news/${DAY}.md`, MARKDOWN);
  const listed = await env.NOOK_BUCKET.list({ prefix: "_state/study/" });
  await Promise.all(listed.objects.map((object) => env.NOOK_BUCKET.delete(object.key)));
});

describe("POST /api/study/:app", () => {
  it("generates terms from the article with JSON output and caches them", async () => {
    const id = await articleId();
    const { deps, calls } = buildDeps(() => geminiReply(TERMS));

    const first = await handleRequest(post({ article_id: id, date: DAY, kind: "terms" }), testEnv(), deps);
    const second = await handleRequest(post({ article_id: id, date: DAY, kind: "terms" }), testEnv(), deps);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ kind: "terms", terms: TERMS.terms });
    expect(await second.json()).toEqual({ kind: "terms", terms: TERMS.terms });
    expect(calls.filter((call) => call.url.startsWith(GEMINI))).toHaveLength(1);
    const request = JSON.parse(calls[0].body);
    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(request.contents[0].parts[0].text).toContain("KV キャッシュを量子化");
    expect(await env.NOOK_BUCKET.get(studyCacheKey("jp_tech_news", DAY, id, "terms"))).not.toBeNull();
  });

  it("generates a three-question quiz", async () => {
    const id = await articleId();
    const { deps } = buildDeps(() => geminiReply(QUIZ));

    const response = await handleRequest(post({ article_id: id, date: DAY, kind: "quiz" }), testEnv(), deps);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { questions: unknown[] };
    expect(body.questions).toHaveLength(3);
  });

  it("returns 502 and caches nothing when the model output has the wrong shape", async () => {
    const id = await articleId();
    const { deps } = buildDeps(() => geminiReply({ terms: [{ word: "" }] }));

    const response = await handleRequest(post({ article_id: id, date: DAY, kind: "terms" }), testEnv(), deps);

    expect(response.status).toBe(502);
    expect(await env.NOOK_BUCKET.get(studyCacheKey("jp_tech_news", DAY, id, "terms"))).toBeNull();
  });

  it("rejects unknown kinds, unknown articles and cross-site requests", async () => {
    const id = await articleId();
    const { deps, calls } = buildDeps(() => geminiReply(TERMS));

    const kind = await handleRequest(post({ article_id: id, date: DAY, kind: "essay" }), testEnv(), deps);
    const missing = await handleRequest(post({ article_id: "nope", date: DAY, kind: "terms" }), testEnv(), deps);
    const crossSite = await handleRequest(
      post({ article_id: id, date: DAY, kind: "terms" }, "https://evil.example"),
      testEnv(),
      deps,
    );

    expect([kind.status, missing.status, crossSite.status]).toEqual([400, 404, 403]);
    expect(calls).toHaveLength(0);
  });
});

describe("study output parsers", () => {
  it("keeps at most six terms and drops nothing valid", () => {
    const many = { terms: Array.from({ length: 8 }, (_, i) => ({ word: `w${i}`, explanation: "e" })) };
    expect(parseTerms(many)).toHaveLength(6);
  });

  it("rejects quizzes whose answer is outside the choices", () => {
    const broken = { questions: [{ ...QUIZ.questions[0], answer_index: 4 }, QUIZ.questions[1], QUIZ.questions[2]] };
    expect(() => parseQuiz(broken)).toThrow();
  });
});
