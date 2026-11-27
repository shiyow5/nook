import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { type AppDeps, handleRequest } from "../src/app";

const ORIGIN = "https://nook-viewer.example.workers.dev";
const DAY = "2026-11-22";
const MARKDOWN = "# KV キャッシュの圧縮\n\n[View on Zenn](https://zenn.dev/a)\n\nKV キャッシュを量子化してメモリを減らす。";
const REVIEW = {
  understood: ["量子化でメモリを減らす点は合っています。"],
  gaps: ["速度が上がるとは書かれていません。"],
  extras: ["量子化の誤差について調べると理解が深まります。"],
};

function buildDeps(reply: () => Response) {
  const calls: { url: string; body: string }[] = [];
  const deps: AppDeps = {
    fetch: async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return reply();
    },
    verifyAccess: async () => true,
    now: () => new Date("2026-11-26T03:00:00Z"),
  };
  return { deps, calls };
}

const gemini = (payload: unknown) => () =>
  Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });

const testEnv = () => ({ ...env, GOOGLE_API_KEY: "k" });

async function articleId(): Promise<string> {
  const response = await handleRequest(
    new Request(`${ORIGIN}/api/markdown/jp_tech_news?date=${DAY}`),
    testEnv(),
    buildDeps(() => new Response("unused")).deps,
  );
  return ((await response.json()) as { articles: { article_id: string }[] }).articles[0].article_id;
}

function post(body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/practice/jp_tech_news`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await env.NOOK_BUCKET.put(`jp_tech_news/${DAY}.md`, MARKDOWN);
});

describe("summary review (#19)", () => {
  it("reviews the summary against the article and keeps the exchange in D1", async () => {
    const id = await articleId();
    const { deps, calls } = buildDeps(gemini(REVIEW));
    const summary = "KV キャッシュを量子化してメモリを減らし、速度も 2 倍になる手法。";

    const response = await handleRequest(post({ kind: "review", date: DAY, article_id: id, summary }), testEnv(), deps);
    const history = await handleRequest(
      new Request(`${ORIGIN}/api/practice/jp_tech_news?date=${DAY}&article_id=${id}`),
      testEnv(),
      deps,
    );

    expect(response.status).toBe(200);
    const { session } = (await response.json()) as { session: { kind: string; output: unknown; input: unknown } };
    expect(session).toMatchObject({ kind: "review", input: { summary }, output: REVIEW });
    const prompt = JSON.parse(calls[0].body).contents[0].parts[0].text as string;
    expect(prompt).toContain("KV キャッシュを量子化してメモリを減らす。");
    expect(prompt).toContain(summary);
    const { sessions } = (await history.json()) as { sessions: unknown[] };
    expect(sessions).toHaveLength(1);
  });

  it("rejects short summaries, unknown articles, bad output and cross-site posts", async () => {
    const id = await articleId();
    const { deps } = buildDeps(gemini({ understood: [], gaps: [], extras: [] }));
    const summary = "これは二十字以上ある要約の文章です。内容を書きました。";

    const short = await handleRequest(post({ kind: "review", date: DAY, article_id: id, summary: "短い" }), testEnv(), deps);
    const unknown = await handleRequest(post({ kind: "review", date: DAY, article_id: "article-nope", summary }), testEnv(), deps);
    const empty = await handleRequest(post({ kind: "review", date: DAY, article_id: id, summary }), testEnv(), deps);
    const crossSite = await handleRequest(
      post({ kind: "review", date: DAY, article_id: id, summary }, "https://evil.example"),
      testEnv(),
      deps,
    );

    expect([short.status, unknown.status, empty.status, crossSite.status]).toEqual([400, 404, 502, 403]);
  });

  it("adds the practice panel and its button to the detail screen", async () => {
    const { deps } = buildDeps(() => new Response("unused"));

    const html = await (await handleRequest(new Request(`${ORIGIN}/read?date=${DAY}&tab=jp_tech_news`), testEnv(), deps)).text();

    expect(html).toContain('id="practice-panel"');
    expect(html).toContain('id="practice-fab"');
    expect(html).toMatch(/<script defer src="\/static\/practice.js\?v=[^"]+"><\/script>/);
  });
});

describe("case study (#20)", () => {
  const CASE = { situation: "社内の RAG で回答が遅い。", question: "まず何を確かめますか。", hints: ["量子化", "評価の仕方"] };
  const CASE_REVIEW = { good_points: ["測り方を疑う点が良い。"], risks: ["本番のクエリの分布"], model_answer: "- 1 件ずつ測る" };

  it("asks the same question until a fresh one is requested", async () => {
    const id = await articleId();
    const { deps, calls } = buildDeps(gemini(CASE));
    const ask = (fresh: boolean) =>
      handleRequest(post({ kind: "case_question", date: DAY, article_id: id, fresh }), testEnv(), deps);

    const first = (await (await ask(false)).json()) as { case: unknown };
    const second = (await (await ask(false)).json()) as { case: unknown };
    await ask(true);

    expect(first.case).toEqual(CASE);
    expect(second.case).toEqual(CASE);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].body).contents[0].parts[0].text).toContain("KV キャッシュを量子化");
  });

  it("reviews the answer against the stored question and saves it", async () => {
    const id = await articleId();
    await handleRequest(post({ kind: "case_question", date: DAY, article_id: id, fresh: true }), testEnv(), buildDeps(gemini(CASE)).deps);
    const { deps, calls } = buildDeps(gemini(CASE_REVIEW));

    const response = await handleRequest(
      post({ kind: "case_review", date: DAY, article_id: id, answer: "まずバッチと 1 件ずつの両方で測り直す。", question: "偽の問い" }),
      testEnv(),
      deps,
    );

    const { session } = (await response.json()) as { session: { kind: string; input: { question: string }; output: unknown } };
    expect(session.kind).toBe("case");
    expect(session.input.question).toBe(CASE.question);
    expect(session.output).toEqual(CASE_REVIEW);
    const prompt = JSON.parse(calls[0].body).contents[0].parts[0].text as string;
    expect(prompt).toContain("まず何を確かめますか。");
    expect(prompt).not.toContain("偽の問い");
  });

  it("refuses to review before a question exists and rejects short answers", async () => {
    await env.NOOK_BUCKET.put(`jp_tech_news/2026-11-23.md`, MARKDOWN);
    const response = await handleRequest(
      new Request(`${ORIGIN}/api/markdown/jp_tech_news?date=2026-11-23`),
      testEnv(),
      buildDeps(() => new Response("unused")).deps,
    );
    const id = ((await response.json()) as { articles: { article_id: string }[] }).articles[0].article_id;
    const { deps } = buildDeps(gemini(CASE_REVIEW));

    const noQuestion = await handleRequest(
      post({ kind: "case_review", date: "2026-11-23", article_id: id, answer: "十分に長い回答を書きました。" }),
      testEnv(),
      deps,
    );
    const short = await handleRequest(post({ kind: "case_review", date: "2026-11-23", article_id: id, answer: "短い" }), testEnv(), deps);

    expect([noQuestion.status, short.status]).toEqual([409, 400]);
  });
});
