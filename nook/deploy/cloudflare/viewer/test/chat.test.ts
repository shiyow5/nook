import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { buildChatPrompt, collectAdditionalContext, sourceTextKey } from "../src/chat";

const ARTICLE = "# 記事\n\n[View on Reddit](https://www.reddit.com/r/x/comments/1/a/)\n\n要約。関連: https://other.example/b";

function fetchRecorder(responses: Record<string, string>) {
  const calls: string[] = [];
  const fetchFn = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = responses[url];
    return body === undefined
      ? new Response("blocked", { status: 403 })
      : new Response(`<html><body><main><p>${body}</p></main></body></html>`, { status: 200 });
  };
  return { calls, fetchFn };
}

describe("chat context (#34)", () => {
  it("uses the same key as the Python collector", async () => {
    // tests/unit/test_collector_storage_sources.py と同じ値
    expect(await sourceTextKey("https://example.com/a")).toBe("_state/_sources/2dce0a4c50441bfccfa9caf4b58c3cba.txt");
  });

  it("reads the collector's copy from R2 instead of fetching, and gives the article more room", async () => {
    const primary = "https://www.reddit.com/r/x/comments/1/a/";
    await env.NOOK_BUCKET.put(await sourceTextKey(primary), "本".repeat(7000));
    const { calls, fetchFn } = fetchRecorder({ "https://other.example/b": "o".repeat(3000) });

    const result = await collectAdditionalContext({ markdown: ARTICLE, message: "質問", fetchFn, bucket: env.NOOK_BUCKET });

    expect(calls).toEqual(["https://other.example/b"]);
    expect(result.context).toContain(`- Content from ${primary}:\n\n'''${"本".repeat(6000)}...'''`);
    expect(result.context).toContain(`'''${"o".repeat(1000)}...'''`);
    expect(result.failedLinks).toEqual([]);
  });

  it("lists links it could not read and tells the model to say so", async () => {
    const { fetchFn } = fetchRecorder({});

    const result = await collectAdditionalContext({
      markdown: "# 記事\n\n[View on TechCrunch](https://techcrunch.example/a)\n\n要約",
      message: "質問",
      fetchFn,
      bucket: env.NOOK_BUCKET,
    });
    const prompt = buildChatPrompt({
      markdown: "記事",
      additionalContext: result.context,
      chatHistory: "なし",
      message: "質問",
      failedLinks: result.failedLinks,
    });

    expect(result.failedLinks).toEqual(["https://techcrunch.example/a"]);
    expect(prompt).toContain("[本文を取得できなかったリンク]\n\n- https://techcrunch.example/a");
    expect(prompt).toContain("回答の冒頭で一言断ってください");
  });
});
